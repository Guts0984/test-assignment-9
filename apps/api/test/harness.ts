import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { hashPassword, seedDatabase, users, type Db } from '@app/db';
import { createTestDb, type TestDb } from '@app/db/testing';
import type { Role } from '@app/shared';
import { createApp, type CreatedApp } from '../src/app';
import { loadEnv, type Env } from '../src/env';

export type Reply = {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Parsed JSON when possible, otherwise the raw text. */
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper, shape asserted per test
  text: string;
  ms: number;
  cookie: string | undefined;
};

export type CallOptions = {
  method?: string;
  path: string;
  json?: unknown;
  /** Raw body (string/Buffer) instead of `json`. */
  raw?: string | Buffer;
  contentType?: string | null;
  cookie?: string;
  headers?: Record<string, string>;
  /** Source IP to connect from: any 127.x.y.z address works on Linux and is a genuinely different peer. */
  from?: string;
  timeoutMs?: number;
};

export type TestApp = {
  url: string;
  port: number;
  env: Env;
  db: Db;
  testDb: TestDb;
  /** Only for in-process apps. Hostile tests run the server as a separate process. */
  created: CreatedApp | undefined;
  call: (o: CallOptions) => Promise<Reply>;
  login: (username: string, password: string, from?: string) => Promise<string>;
  close: () => Promise<void>;
};

export const PASSWORDS = {
  waiter1: 'waiter1-test-password',
  waiter2: 'waiter2-test-password',
  cook1: 'cook1-test-password',
  manager: 'manager-test-password',
} as const;

const raw = (port: number, o: CallOptions): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const started = performance.now();
    const body =
      o.raw !== undefined ? o.raw : o.json !== undefined ? JSON.stringify(o.json) : undefined;
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.contentType !== null && body !== undefined) {
      headers['content-type'] = o.contentType ?? 'application/json';
    }
    if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));
    if (o.cookie) headers.cookie = o.cookie;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
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
            /* keep text */
          }
          const setCookie = res.headers['set-cookie']?.[0];
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: parsed,
            text,
            ms: performance.now() - started,
            cookie: setCookie ? setCookie.split(';')[0] : undefined,
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

export const insertUser = async (
  db: Db,
  username: string,
  password: string,
  role: Role,
  active = true,
) => {
  const [u] = await db
    .insert(users)
    .values({
      username,
      displayName: username,
      passwordHash: await hashPassword(password),
      role,
      active,
    })
    .returning();
  return u!;
};

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Starts `src/main.ts` as its own OS process, exactly as production does. */
const spawnServer = async (
  env: Record<string, string>,
): Promise<{ child: ChildProcess; port: number; stop: () => Promise<void> }> => {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: API_DIR,
    env: {
      PATH: process.env.PATH ?? '',
      ...env,
      PORT: String(port),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30_000);
    const onData = (d: Buffer) => {
      output += d.toString();
      if (output.includes('API listening')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code}):\n${output}`));
    });
  });
  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    });
  return { child, port, stop };
};

export type StartOptions = {
  /** Load the full reference seed (20 tables, 60 dishes, 60 days of history) instead of 4 bare users. */
  fullSeed?: boolean;
  /** Run the server in a separate OS process (needed for honest latency measurements). */
  separateProcess?: boolean;
};

/** Boots the real application against a fresh real PostgreSQL database. */
export const startTestApp = async (
  overrides: Record<string, string> = {},
  options: StartOptions = {},
  prepare?: (db: Db) => Promise<void>,
): Promise<TestApp> => {
  const testDb = await createTestDb({ max: 15 });
  if (options.fullSeed) {
    await seedDatabase(testDb.db, {
      tz: 'Europe/Kyiv',
      passwords: { waiter: PASSWORDS.waiter1, cook: PASSWORDS.cook1, manager: PASSWORDS.manager },
    });
  } else {
    await insertUser(testDb.db, 'waiter1', PASSWORDS.waiter1, 'waiter');
    await insertUser(testDb.db, 'waiter2', PASSWORDS.waiter2, 'waiter');
    await insertUser(testDb.db, 'cook1', PASSWORDS.cook1, 'cook');
    await insertUser(testDb.db, 'manager', PASSWORDS.manager, 'manager');
  }
  if (prepare) await prepare(testDb.db);

  const envInput = {
    DATABASE_URL: testDb.url,
    PORT: '0',
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    ...overrides,
  };
  const env = loadEnv(envInput);

  let port: number;
  let created: CreatedApp | undefined;
  let stopServer: () => Promise<void>;
  if (options.separateProcess) {
    const server = await spawnServer(envInput);
    port = server.port;
    stopServer = server.stop;
  } else {
    created = await createApp(env);
    await created.app.listen(0, '127.0.0.1');
    port = (created.app.getHttpServer().address() as AddressInfo).port;
    stopServer = () => created!.app.close();
  }

  const call = (o: CallOptions) => raw(port, o);
  const login = async (username: string, password: string, from?: string): Promise<string> => {
    const r = await call({
      method: 'POST',
      path: '/auth/login',
      json: { username, password },
      from,
    });
    if (r.status !== 200 || !r.cookie)
      throw new Error(`login failed for ${username}: ${r.status} ${r.text}`);
    return r.cookie;
  };
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    env,
    db: testDb.db,
    testDb,
    created,
    call,
    login,
    close: async () => {
      await stopServer();
      await testDb.drop();
    },
  };
};

export const deactivate = (db: Db, username: string) =>
  db.update(users).set({ active: false }).where(eq(users.username, username));

export const percentile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
