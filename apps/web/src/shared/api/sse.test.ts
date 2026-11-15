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
