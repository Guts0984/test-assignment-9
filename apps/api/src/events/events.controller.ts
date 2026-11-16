import { Controller, Inject, type MessageEvent, Req, Sse } from '@nestjs/common';
import type { DbHandle } from '@app/db';
import { Observable, finalize } from 'rxjs';
import { Endpoint } from '../common/endpoint';
import { unauthenticated } from '../common/errors';
import type { AppRequest } from '../common/request';
import { findSession, readSessionToken } from '../auth/session';
import { DB, ENV } from '../common/tokens';
import type { Env } from '../env';
import { clientKey } from '../rate-limit/client-ip';
import { EventsService } from './events.service';

@Controller()
export class EventsController {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
  ) {}

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
    const token = readSessionToken(req.headers.cookie, this.env.COOKIE_SECURE);
    return new Observable<MessageEvent>((subscriber) => {
      const forget = this.events.track(sessionId, () => subscriber.complete());
      subscriber.next({ type: 'ready', data: {} });
      const unsubscribe = this.events.subscribe((e) => subscriber.next({ type: e.type, data: e }));
      // Every beat also proves the session is still valid: expiry, logout elsewhere or a deactivated user
      // end the stream (it was only checked once, at connection time).
      let checking = false;
      const heartbeat = setInterval(() => {
        subscriber.next({ type: 'ping', data: {} });
        if (checking || !token) return;
        checking = true;
        findSession(this.handle.db, token)
          .then((found) => {
            if (!found) subscriber.complete();
          })
          .catch(() => undefined) // a database hiccup must not kick everybody out
          .finally(() => {
            checking = false;
          });
      }, this.env.SSE_HEARTBEAT_MS);
      return () => {
        clearInterval(heartbeat);
        forget();
        unsubscribe();
      };
    }).pipe(finalize(release));
  }
}
