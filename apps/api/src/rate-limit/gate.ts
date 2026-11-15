/**
 * Concurrency gate for expensive work (password hashing).
 *
 * - At most `max` jobs run at once. Extra jobs wait in a FIFO queue instead of being refused, so a burst of
 *   honest logins just takes a little longer.
 * - One client key (an IP) can never run more than `perKeyRunning` jobs at once and never has more than
 *   `perKeyWaiting` jobs queued, so a flood from one address cannot occupy the whole gate.
 * - A waiting job gives up after `waitMs` (the caller answers 429), and the queue is bounded.
 */
export type Gate = {
  /** Resolves with a release function, or `null` when the caller should be told to retry later. */
  acquire: (key: string) => Promise<(() => void) | null>;
  stats: () => { running: number; waiting: number };
};

type Waiter = { key: string; grant: (release: () => void) => void; timer: NodeJS.Timeout };

export type GateOptions = {
  max: number;
  perKeyRunning: number;
  perKeyWaiting: number;
  maxWaiting: number;
  waitMs: number;
};

export const createGate = (opts: GateOptions): Gate => {
  let running = 0;
  const runningBy = new Map<string, number>();
  const waitingBy = new Map<string, number>();
  const queue: Waiter[] = [];

  const bump = (m: Map<string, number>, key: string, d: number): void => {
    const n = (m.get(key) ?? 0) + d;
    if (n <= 0) m.delete(key);
    else m.set(key, n);
  };

  const start = (key: string): (() => void) => {
    running++;
    bump(runningBy, key, 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      running--;
      bump(runningBy, key, -1);
      pump();
    };
  };

  const pump = (): void => {
    while (running < opts.max) {
      const i = queue.findIndex((w) => (runningBy.get(w.key) ?? 0) < opts.perKeyRunning);
      if (i < 0) return;
      const [w] = queue.splice(i, 1);
      if (!w) return;
      clearTimeout(w.timer);
      bump(waitingBy, w.key, -1);
      w.grant(start(w.key));
    }
  };

  return {
    acquire: (key) =>
      new Promise((resolve) => {
        if (running < opts.max && (runningBy.get(key) ?? 0) < opts.perKeyRunning) {
          resolve(start(key));
          return;
        }
        if (queue.length >= opts.maxWaiting || (waitingBy.get(key) ?? 0) >= opts.perKeyWaiting) {
          resolve(null);
          return;
        }
        const waiter: Waiter = {
          key,
          grant: resolve,
          timer: setTimeout(() => {
            const i = queue.indexOf(waiter);
            if (i >= 0) {
              queue.splice(i, 1);
              bump(waitingBy, key, -1);
            }
            resolve(null);
          }, opts.waitMs),
        };
        waiter.timer.unref();
        queue.push(waiter);
        bump(waitingBy, key, 1);
      }),
    stats: () => ({ running, waiting: queue.length }),
  };
};
