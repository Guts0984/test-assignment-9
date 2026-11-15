import { Inject, Injectable } from '@nestjs/common';
import type { AppEvent } from '@app/shared';
import { AppError } from '../common/errors';
import { ENV } from '../common/tokens';
import type { Env } from '../env';

type Listener = (event: AppEvent) => void;

/**
 * In-process event bus for SSE (no Redis, no queue). Services emit AFTER their transaction has
 * committed, so a client never learns about something that was rolled back.
 * Limits: this is per API process; the assignment runs a single api instance.
 */
@Injectable()
export class EventsService {
  private readonly listeners = new Set<Listener>();
  private readonly perIp = new Map<string, number>();
  private readonly perUser = new Map<string, number>();
  private readonly bySession = new Map<string, Set<() => void>>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  emit(...events: AppEvent[]): void {
    for (const event of events) {
      for (const listener of [...this.listeners]) {
        try {
          listener(event);
        } catch {
          /* one broken client must never affect the others or the request that emitted */
        }
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  /** Remembers an open stream of a session so that logging out can end it. Returns the forget function. */
  track(sessionId: string, close: () => void): () => void {
    const set = this.bySession.get(sessionId) ?? new Set<() => void>();
    set.add(close);
    this.bySession.set(sessionId, set);
    return () => {
      set.delete(close);
      if (set.size === 0 && this.bySession.get(sessionId) === set) this.bySession.delete(sessionId);
    };
  }

  /** Ends every open stream of a session (called on logout). */
  closeSession(sessionId: string): void {
    for (const close of [...(this.bySession.get(sessionId) ?? [])]) close();
  }

  /** Reserves an SSE slot for this IP and user; returns the release function. */
  acquire(ipKey: string, userId: string): () => void {
    const ip = this.perIp.get(ipKey) ?? 0;
    const user = this.perUser.get(userId) ?? 0;
    if (ip >= this.env.SSE_MAX_PER_IP || user >= this.env.SSE_MAX_PER_USER) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many open event streams', undefined, {
        'Retry-After': '5',
      });
    }
    this.perIp.set(ipKey, ip + 1);
    this.perUser.set(userId, user + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const [map, key] of [
        [this.perIp, ipKey],
        [this.perUser, userId],
      ] as const) {
        const n = (map.get(key) ?? 1) - 1;
        if (n <= 0) map.delete(key);
        else map.set(key, n);
      }
    };
  }
}
