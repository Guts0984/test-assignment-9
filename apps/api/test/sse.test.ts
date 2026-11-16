import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventsService } from '../src/events/events.service';
import type { TestApp } from './harness';
import { PASSWORDS, itNet } from './harness';
import { add, open, resetStock, send, startSession, type Session } from './world';

type Evt = { event: string; data: Record<string, unknown> };
type Stream = {
  status: number;
  headers: http.IncomingHttpHeaders;
  events: Evt[];
  body: string;
  waitFor: (pred: (e: Evt) => boolean, ms?: number) => Promise<Evt>;
  close: () => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A real SSE client: reads the stream incrementally and parses `event:` / `data:` frames. */
const openStream = (app: TestApp, cookie: string | undefined, from?: string): Promise<Stream> =>
  new Promise((resolve, reject) => {
    const events: Evt[] = [];
    let body = '';
    let buf = '';
    const waiters: { pred: (e: Evt) => boolean; ok: (e: Evt) => void }[] = [];
    const req = http.request(
      {
        host: '127.0.0.1',
        port: app.port,
        path: '/events',
        method: 'GET',
        headers: { ...(cookie ? { cookie } : {}), accept: 'text/event-stream' },
        localAddress: from,
        agent: false,
      },
      (res) => {
        const stream: Stream = {
          status: res.statusCode ?? 0,
          headers: res.headers,
          events,
          get body() {
            return body;
          },
          waitFor: (pred, ms = 3000) =>
            new Promise((ok, no) => {
              const found = events.find(pred);
              if (found) return ok(found);
              const t = setTimeout(
                () =>
                  no(
                    new Error(
                      `timed out waiting for event; got ${JSON.stringify(events.slice(-5))}`,
                    ),
                  ),
                ms,
              );
              waiters.push({ pred, ok: (e) => (clearTimeout(t), ok(e)) });
            }),
          close: () => req.destroy(),
        } as Stream;
        if (stream.status !== 200) {
          res.on('data', (c: Buffer) => (body += c.toString()));
          res.on('end', () => resolve(stream));
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          buf += chunk;
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(frame)?.[1];
            const data = /^data: (.*)$/m.exec(frame)?.[1];
            if (!ev) continue;
            const e: Evt = { event: ev, data: data ? JSON.parse(data) : {} };
            events.push(e);
            for (const w of [...waiters])
              if (w.pred(e)) {
                waiters.splice(waiters.indexOf(w), 1);
                w.ok(e);
              }
          }
        });
        resolve(stream);
      },
    );
    req.on('error', (e) =>
      (e as NodeJS.ErrnoException).code === 'ECONNRESET' ? undefined : reject(e),
    );
    req.end();
  });

let s: Session;
let waiterCookie: string;
let cookCookie: string;
let managerCookie: string;
beforeAll(async () => {
  s = await startSession({ SSE_MAX_PER_USER: '3', SSE_MAX_PER_IP: '8' });
  [waiterCookie, cookCookie, managerCookie] = await Promise.all([
    s.app.login('waiter1', PASSWORDS.waiter1),
    s.app.login('cook1', PASSWORDS.cook1),
    s.app.login('manager', PASSWORDS.manager),
  ]);
});
afterAll(async () => {
  await s.app.close();
});

describe('the stream', () => {
  it('needs a session', async () => {
    const r = await openStream(s.app, undefined);
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body).error.code).toBe('UNAUTHENTICATED');
  });
  it('is a proper event stream: right headers, a first "ready" event', async () => {
    const st = await openStream(s.app, waiterCookie);
    try {
      expect(st.status).toBe(200);
      expect(st.headers['content-type']).toMatch(/text\/event-stream/);
      expect(st.headers['cache-control']).toMatch(/no-cache/);
      expect(st.headers['x-accel-buffering']).toBe('no');
      await st.waitFor((e) => e.event === 'ready');
    } finally {
      st.close();
    }
  });
});

describe('real-time flow: order → kitchen → ready, without reloading', () => {
  it('the cook receives the new item; the waiter receives "cooking" and "ready"; tables update', async () => {
    const waiter = await openStream(s.app, waiterCookie);
    const cook = await openStream(s.app, cookCookie);
    try {
      let o = await open(s.waiter1, s.world.tables[0]!, 2);
      o = await add(s.waiter1, o, s.world.soup.id);
      o = await send(s.waiter1, o);
      const itemId = o.items[0]!.id;

      await cook.waitFor(
        (e) => e.event === 'item.changed' && e.data.itemId === itemId && e.data.status === 'sent',
      );
      expect(
        (await s.cook.get('/kitchen')).body.items.some((i: { id: string }) => i.id === itemId),
      ).toBe(true);

      await s.cook.patch(`/kitchen/items/${itemId}`, { status: 'cooking' });
      await waiter.waitFor(
        (e) =>
          e.event === 'item.changed' && e.data.itemId === itemId && e.data.status === 'cooking',
      );
      await s.cook.patch(`/kitchen/items/${itemId}`, { status: 'ready' });
      const ready = await waiter.waitFor(
        (e) => e.event === 'item.changed' && e.data.itemId === itemId && e.data.status === 'ready',
      );
      expect(ready.data.orderId).toBe(o.id);
      await waiter.waitFor(
        (e) => e.event === 'table.changed' && e.data.tableId === s.world.tables[0],
      );
      // the event is just a nudge; the data is fetched and is correct
      const row = (
        (await s.waiter1.get('/tables')).body.tables as { id: string; state: string }[]
      ).find((t) => t.id === s.world.tables[0])!;
      expect(row.state).toBe('ready');
    } finally {
      waiter.close();
      cook.close();
    }
  });
  it('a cancelled item reaches the kitchen', async () => {
    const cook = await openStream(s.app, cookCookie);
    try {
      let o = await open(s.waiter1, s.world.tables[1]!, 2);
      o = await add(s.waiter1, o, s.world.soup.id);
      o = await send(s.waiter1, o);
      await s.waiter1.del(`/orders/${o.id}/items/${o.items[0]!.id}?expectedVersion=${o.version}`);
      await cook.waitFor(
        (e) =>
          e.event === 'item.changed' &&
          e.data.itemId === o.items[0]!.id &&
          e.data.status === 'cancelled',
      );
    } finally {
      cook.close();
    }
  });
  it('the stop-list change reaches every role at once; returning the portion lifts it', async () => {
    await resetStock(s.app.db, s.world.lastLamb.id, 1);
    const streams = await Promise.all(
      [waiterCookie, cookCookie, managerCookie].map((c) => openStream(s.app, c)),
    );
    try {
      let o = await open(s.waiter1, s.world.tables[2]!, 2);
      o = await add(s.waiter1, o, s.world.lastLamb.id);
      o = await send(s.waiter1, o);
      const isStop = (v: boolean) => (e: Evt) =>
        e.event === 'stoplist.changed' &&
        e.data.dishId === s.world.lastLamb.id &&
        e.data.stopListed === v;
      await Promise.all(streams.map((st) => st.waitFor(isStop(true))));
      await s.waiter1.del(`/orders/${o.id}/items/${o.items[0]!.id}?expectedVersion=${o.version}`);
      await Promise.all(streams.map((st) => st.waitFor(isStop(false))));
    } finally {
      streams.forEach((st) => st.close());
    }
  });
  it('a manager editing the menu or stock is announced', async () => {
    const waiter = await openStream(s.app, waiterCookie);
    try {
      await s.manager.patch(`/dishes/${s.world.soup.id}`, { stock: 0 });
      await waiter.waitFor(
        (e) =>
          e.event === 'stoplist.changed' &&
          e.data.dishId === s.world.soup.id &&
          e.data.stopListed === true,
      );
      await waiter.waitFor((e) => e.event === 'menu.changed');
      await s.manager.patch(`/dishes/${s.world.soup.id}`, { stock: null });
      await waiter.waitFor(
        (e) =>
          e.event === 'stoplist.changed' &&
          e.data.dishId === s.world.soup.id &&
          e.data.stopListed === false,
      );
    } finally {
      waiter.close();
    }
  });
  it('nothing is announced for work that was rolled back (failed send)', async () => {
    await resetStock(s.app.db, s.world.fondant.id, 1);
    const waiter = await openStream(s.app, waiterCookie);
    try {
      let o = await open(s.waiter1, s.world.tables[3]!, 2);
      o = await add(s.waiter1, o, s.world.fondant.id);
      o = await add(s.waiter1, o, s.world.fondant.id);
      const before = waiter.events.length;
      const r = await s.waiter1.post(`/orders/${o.id}/send`, { expectedVersion: o.version });
      expect(r.status).toBe(409);
      await sleep(200);
      const fresh = waiter.events
        .slice(before)
        .filter((e) => e.event === 'item.changed' || e.event === 'stoplist.changed');
      expect(fresh).toEqual([]);
    } finally {
      waiter.close();
    }
  });
  it('events carry ids only: no prices, totals or names', async () => {
    const st = await openStream(s.app, waiterCookie);
    try {
      let o = await open(s.waiter1, s.world.tables[4]!, 2);
      o = await add(s.waiter1, o, s.world.steak.id, { modifierIds: [s.world.steak.mods['Rare']!] });
      await send(s.waiter1, o);
      await st.waitFor((e) => e.event === 'item.changed');
      expect(st.body).not.toMatch(/price|total|amount|surcharge|Steak|comment|password/i);
    } finally {
      st.close();
    }
  });
});

describe('connection limits and cleanup', () => {
  it('a user can hold only SSE_MAX_PER_USER streams; the next gets 429; freeing one makes room', async () => {
    const open3 = await Promise.all([0, 1, 2].map(() => openStream(s.app, managerCookie)));
    try {
      expect(open3.every((x) => x.status === 200)).toBe(true);
      const fourth = await openStream(s.app, managerCookie);
      expect(fourth.status).toBe(429);
      expect(fourth.headers['retry-after']).toBeDefined();
      open3[0]!.close();
      await sleep(200);
      const again = await openStream(s.app, managerCookie);
      expect(again.status).toBe(200);
      again.close();
    } finally {
      open3.forEach((x) => x.close());
    }
  });
  itNet('one IP cannot open unlimited streams even with many accounts or sessions', async () => {
    const cookies = await Promise.all(
      Array.from({ length: 4 }, () => s.app.login('waiter2', PASSWORDS.waiter2)),
    );
    const streams: Stream[] = [];
    try {
      for (const c of cookies) {
        for (let i = 0; i < 3; i++) streams.push(await openStream(s.app, c, '127.0.0.60'));
      }
      const ok = streams.filter((x) => x.status === 200).length;
      expect(ok).toBeLessThanOrEqual(3); // per user cap (waiter2 is one user) …
      const manyUsers = await Promise.all(
        [waiterCookie, cookCookie, managerCookie].map((c) => openStream(s.app, c, '127.0.0.61')),
      );
      streams.push(...manyUsers);
      expect(manyUsers.every((x) => x.status === 200)).toBe(true);
    } finally {
      streams.forEach((x) => x.close());
    }
  });
  it('closed streams are cleaned up: no listeners or slots leak', async () => {
    const events = s.app.created!.app.get(EventsService);
    await sleep(300);
    const baseline = events.subscriberCount;
    const many = await Promise.all(
      Array.from({ length: 3 }, () => openStream(s.app, waiterCookie)),
    );
    expect(events.subscriberCount).toBe(baseline + 3);
    many.forEach((x) => x.close());
    await sleep(300);
    expect(events.subscriberCount).toBe(baseline);
    // and the slots are free again
    const again = await Promise.all(
      Array.from({ length: 3 }, () => openStream(s.app, waiterCookie)),
    );
    expect(again.every((x) => x.status === 200)).toBe(true);
    again.forEach((x) => x.close());
  });
  it('a logged-out session cannot open a stream any more', async () => {
    const c = await s.app.login('waiter2', PASSWORDS.waiter2);
    await s.app.call({ method: 'POST', path: '/auth/logout', cookie: c });
    expect((await openStream(s.app, c)).status).toBe(401);
  });
});
