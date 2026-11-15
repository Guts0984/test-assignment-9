import { Controller, Inject, type MessageEvent, Req, Sse } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { Endpoint } from '../common/endpoint';
import { unauthenticated } from '../common/errors';
import type { AppRequest } from '../common/request';
import { clientKey } from '../rate-limit/client-ip';
import { EventsService } from './events.service';

const HEARTBEAT_MS = 15_000;

@Controller()
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  @Sse('events')
  @Endpoint({
    access: 'any',
    tag: 'Realtime',
    summary:
      'Server-sent events: item.changed, stoplist.changed, table.changed, menu.changed (ids only). Refetch on reconnect.',
  })
  stream(@Req() req: AppRequest): Observable<MessageEvent> {
    if (!req.user) throw unauthenticated();
    // Throws 429 *before* the stream starts when the caller has too many open streams.
    const release = this.events.acquire(clientKey(req.ip), req.user.id);
    const sessionId = req.sessionId ?? '';
    return new Observable<MessageEvent>((subscriber) => {
      const forget = this.events.track(sessionId, () => subscriber.complete());
      subscriber.next({ type: 'ready', data: {} });
      const unsubscribe = this.events.subscribe((e) => subscriber.next({ type: e.type, data: e }));
      const heartbeat = setInterval(
        () => subscriber.next({ type: 'ping', data: {} }),
        HEARTBEAT_MS,
      );
      return () => {
        clearInterval(heartbeat);
        forget();
        unsubscribe();
      };
    }).pipe(finalize(release));
  }
}
