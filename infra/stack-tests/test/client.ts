import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { URL } from 'node:url';

export const STACK = new URL(process.env.STACK_URL ?? 'http://nginx');
export const API_DIRECT = new URL('http://api:4000');

/**
 * Addresses inside the compose subnet that this container answers on: each is a distinct client.
 * A random offset per run makes the suite re-runnable: the API's in-memory limiter state from a
 * previous run (e.g. a login lockout) does not leak into the next one.
 */
const POOL = 150;
const SALT = Math.floor(Math.random() * POOL);
export const ip = (n: number): string => `172.30.0.${100 + ((n + SALT) % POOL)}`;

let prepared = false;
export const ensureClientIps = (): void => {
  if (prepared) return;
  const out = execFileSync('ip', ['-4', '-o', 'addr', 'show'], { encoding: 'utf8' });
  const dev = /^\d+:\s+(\S+)\s+inet 172\.30\.0\./m.exec(out)?.[1];
  if (!dev) throw new Error(`no interface in 172.30.0.0/24 found:\n${out}`);
  for (let k = 0; k < POOL; k++) {
    try {
      execFileSync('ip', ['addr', 'add', `172.30.0.${100 + k}/24`, 'dev', dev]);
    } catch {
      /* already added */
    }
  }
  prepared = true;
};

export type Reply = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper
  text: string;
  ms: number;
  cookie?: string;
};

export type Opts = {
  base?: URL;
  method?: string;
  path: string;
  json?: unknown;
  raw?: string | Buffer;
  cookie?: string;
  headers?: Record<string, string>;
  from?: string;
  timeoutMs?: number;
};

export const call = (o: Opts): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const base = o.base ?? STACK;
    const started = performance.now();
    const body = o.raw ?? (o.json !== undefined ? JSON.stringify(o.json) : undefined);
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (body !== undefined) {
      headers['content-type'] ??= 'application/json';
      headers['content-length'] = String(Buffer.byteLength(body));
    }
    if (o.cookie) headers.cookie = o.cookie;
    const req = http.request(
      {
        host: base.hostname,
        port: base.port || 80,
        method: o.method ?? 'GET',
        path: o.path,
        headers,
        localAddress: o.from,
        agent: false,
        timeout: o.timeoutMs ?? 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = text;
          try {
            parsed = text ? JSON.parse(text) : undefined;
          } catch {
            /* not json */
          }
          const sc = res.headers['set-cookie']?.[0];
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: parsed,
            text,
            ms: performance.now() - started,
            cookie: sc?.split(';')[0],
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

export const login = async (username: string, password: string, from?: string): Promise<string> => {
  const r = await call({
    method: 'POST',
    path: '/api/auth/login',
    json: { username, password },
    from,
  });
  if (r.status !== 200 || !r.cookie)
    throw new Error(`login ${username} failed: ${r.status} ${r.text}`);
  return r.cookie;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const count = (rs: Reply[], status: number) => rs.filter((r) => r.status === status).length;
export const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
export const PASSWORDS = {
  waiter: process.env.SEED_WAITER_PASSWORD ?? '',
  cook: process.env.SEED_COOK_PASSWORD ?? '',
  manager: process.env.SEED_MANAGER_PASSWORD ?? '',
};
