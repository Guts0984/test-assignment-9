import { AppEvent } from '@app/shared';
import { API_BASE } from '@/shared/config';

export type SseHandlers = {
  onEvent: (event: AppEvent) => void;
  /** Fired on every (re)connection: events may have been missed, so refetch what matters. */
  onOpen: () => void;
  onClose: () => void;
};

const EVENT_TYPES = ['item.changed', 'stoplist.changed', 'table.changed', 'menu.changed'] as const;

/**
 * Subscribes to GET /events. Returns an unsubscribe function. The browser's EventSource reconnects by
 * itself; we only translate frames into typed events and report connection state.
 */
export const subscribeToEvents = (
  handlers: SseHandlers,
  make: (url: string) => EventSource = (u) => new EventSource(u),
): (() => void) => {
  const source = make(`${API_BASE}/events`);
  const parse = (raw: MessageEvent<string>) => {
    try {
      const event = AppEvent.safeParse(JSON.parse(raw.data) as unknown);
      if (event.success) handlers.onEvent(event.data);
    } catch {
      /* ignore malformed frames */
    }
  };
  for (const type of EVENT_TYPES)
    source.addEventListener(type, (e) => parse(e as MessageEvent<string>));
  source.addEventListener('ready', () => handlers.onOpen());
  source.onerror = () => handlers.onClose();
  return () => source.close();
};
