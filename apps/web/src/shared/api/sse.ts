import { AppEvent } from '@app/shared';
import { API_BASE } from '@/shared/config';

export type SseHandlers = {
  onEvent: (event: AppEvent) => void;
  /** Fired on every (re)connection: events may have been missed, so refetch what matters. */
  onOpen: () => void;
  onClose: () => void;
};

const EVENT_TYPES = ['item.changed', 'stoplist.changed', 'table.changed', 'menu.changed'] as const;

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 30_000;
const CLOSED = 2; // EventSource.CLOSED

/**
 * Subscribes to GET /events. Returns an unsubscribe function. The browser's EventSource reconnects by
 * itself after a dropped connection, but it gives up for good when the server answers with an error
 * status (an API restart behind the proxy, a stream cap): then the source is CLOSED and we open a new
 * one ourselves, with a growing delay.
 */
export const subscribeToEvents = (
  handlers: SseHandlers,
  make: (url: string) => EventSource = (u) => new EventSource(u),
): (() => void) => {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = RETRY_MIN_MS;
  let stopped = false;

  const parse = (raw: MessageEvent<string>) => {
    try {
      const event = AppEvent.safeParse(JSON.parse(raw.data) as unknown);
      if (event.success) handlers.onEvent(event.data);
    } catch {
      /* ignore malformed frames */
    }
  };

  const connect = () => {
    const s = make(`${API_BASE}/events`);
    source = s;
    for (const type of EVENT_TYPES)
      s.addEventListener(type, (e) => parse(e as MessageEvent<string>));
    s.addEventListener('ready', () => {
      delay = RETRY_MIN_MS;
      handlers.onOpen();
    });
    s.onerror = () => {
      handlers.onClose();
      if (stopped || s.readyState !== CLOSED || timer) return;
      s.close();
      timer = setTimeout(() => {
        timer = null;
        if (!stopped) connect();
      }, delay);
      delay = Math.min(delay * 2, RETRY_MAX_MS);
    };
  };

  connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    source?.close();
  };
};
