import { describe, expect, it, vi } from 'vitest';
import { subscribeToEvents } from './sse';
import { keysToInvalidate } from '../lib/event-keys';

/** A scriptable stand-in for EventSource (plain object: no classes outside the API). */
const makeFakeSource = () => {
  const listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  const src = {
    listeners,
    onerror: null as (() => void) | null,
    closed: false,
    addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    emit(type: string, data: unknown) {
      for (const fn of listeners.get(type) ?? [])
        fn({ data: JSON.stringify(data) } as MessageEvent<string>);
    },
    close() {
      src.closed = true;
    },
  };
  return src;
};
const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('subscribeToEvents', () => {
  it('turns frames into typed events, reports open/close, and unsubscribes', () => {
    const src = makeFakeSource();
    const h = { onEvent: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() };
    const stop = subscribeToEvents(h, () => src as unknown as EventSource);
    src.emit('ready', {});
    expect(h.onOpen).toHaveBeenCalledOnce();
    src.emit('item.changed', { type: 'item.changed', orderId: ID, itemId: ID, status: 'ready' });
    expect(h.onEvent).toHaveBeenCalledWith({
      type: 'item.changed',
      orderId: ID,
      itemId: ID,
      status: 'ready',
    });
    src.onerror?.();
    expect(h.onClose).toHaveBeenCalledOnce();
    stop();
    expect(src.closed).toBe(true);
  });
  it('opens a new stream itself when the browser gave up (server answered with an error status)', async () => {
    vi.useFakeTimers();
    try {
      const made: ReturnType<typeof makeFakeSource>[] = [];
      const h = { onEvent: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() };
      const stop = subscribeToEvents(
        h,
        () => {
          const src = makeFakeSource();
          made.push(src);
          return src as unknown as EventSource;
        },
        () => Promise.resolve(true),
      );
      expect(made).toHaveLength(1);
      // readyState CLOSED: EventSource will never reconnect on its own
      Object.assign(made[0]!, { readyState: 2 });
      made[0]!.onerror?.();
      expect(h.onClose).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1_999);
      expect(made).toHaveLength(1); // not instantly: back off first
      await vi.advanceTimersByTimeAsync(1);
      expect(made).toHaveLength(2);
      // a second failure waits longer (2s → 4s)
      Object.assign(made[1]!, { readyState: 2 });
      made[1]!.onerror?.();
      await vi.advanceTimersByTimeAsync(3_999);
      expect(made).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(made).toHaveLength(3);
      made[2]!.emit('ready', {});
      expect(h.onOpen).toHaveBeenCalledOnce();
      stop();
      expect(made[2]!.closed).toBe(true);
      Object.assign(made[2]!, { readyState: 2 });
      made[2]!.onerror?.();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(made).toHaveLength(3); // after unsubscribe nothing is reopened
    } finally {
      vi.useRealTimers();
    }
  });
  it('while the browser is still retrying by itself (CONNECTING) we do not open a second stream', async () => {
    vi.useFakeTimers();
    try {
      const made: ReturnType<typeof makeFakeSource>[] = [];
      subscribeToEvents(
        { onEvent: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() },
        () => {
          const src = makeFakeSource();
          made.push(src);
          return src as unknown as EventSource;
        },
        () => Promise.resolve(true),
      );
      Object.assign(made[0]!, { readyState: 0 });
      made[0]!.onerror?.();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(made).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('stops for good when the session is gone (401): the app is told, no new stream is opened', async () => {
    vi.useFakeTimers();
    try {
      const made: ReturnType<typeof makeFakeSource>[] = [];
      const h = { onEvent: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(), onUnauthorized: vi.fn() };
      subscribeToEvents(
        h,
        () => {
          const src = makeFakeSource();
          made.push(src);
          return src as unknown as EventSource;
        },
        () => Promise.resolve(false),
      );
      Object.assign(made[0]!, { readyState: 2 });
      made[0]!.onerror?.();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(h.onUnauthorized).toHaveBeenCalledOnce();
      expect(made).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('ignores malformed or unknown payloads instead of crashing', () => {
    const src = makeFakeSource();
    const h = { onEvent: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() };
    subscribeToEvents(h, () => src as unknown as EventSource);
    src.emit('item.changed', { type: 'item.changed', orderId: 'not-a-uuid' });
    for (const fn of src.listeners.get('table.changed') ?? [])
      fn({ data: '{broken' } as MessageEvent<string>);
    expect(h.onEvent).not.toHaveBeenCalled();
  });
});

describe('which caches an event invalidates', () => {
  it('order.changed → that check and the tables (not the kitchen, nothing to cook changed)', () => {
    expect(keysToInvalidate({ type: 'order.changed', orderId: ID })).toEqual([
      ['order', ID],
      ['tables'],
    ]);
  });
  it('item.changed → that check, the kitchen and the tables', () => {
    const keys = keysToInvalidate({
      type: 'item.changed',
      orderId: ID,
      itemId: ID,
      status: 'ready',
    });
    expect(keys).toEqual([['order', ID], ['kitchen'], ['tables']]);
  });
  it('stop-list and menu changes refresh the menu and every open check (drafts get flagged)', () => {
    expect(keysToInvalidate({ type: 'stoplist.changed', dishId: ID, stopListed: true })).toEqual([
      ['menu'],
      ['order'],
    ]);
    expect(keysToInvalidate({ type: 'menu.changed' })).toEqual([['menu'], ['order']]);
  });
  it('table.changed → the tables', () => {
    expect(keysToInvalidate({ type: 'table.changed', tableId: ID })).toEqual([['tables']]);
  });
});
