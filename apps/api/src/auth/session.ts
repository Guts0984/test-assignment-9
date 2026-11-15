import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { parse, serialize } from 'cookie';
import type { Db } from '@app/db';
import { sessions } from '@app/db';
import type { Role } from '@app/shared';
import type { AuthUser } from '../common/request';

/** Cookie token: 32 random bytes, base64url → exactly 43 chars. The DB only ever sees its SHA-256. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const cookieName = (secure: boolean): string => (secure ? '__Host-sid' : 'sid');

export const readSessionToken = (
  cookieHeader: string | undefined,
  secure: boolean,
): string | undefined => {
  if (!cookieHeader || cookieHeader.length > 4096) return undefined;
  let parsed: Record<string, string | undefined>;
  try {
    parsed = parse(cookieHeader);
  } catch {
    return undefined;
  }
  const token = parsed[cookieName(secure)];
  return token !== undefined && TOKEN_RE.test(token) ? token : undefined;
};

export const sessionCookie = (token: string, secure: boolean, ttlHours: number): string =>
  serialize(cookieName(secure), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: ttlHours * 3600,
  });

export const clearedSessionCookie = (secure: boolean): string =>
  serialize(cookieName(secure), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
  });

export const createSession = async (db: Db, userId: string, ttlHours: number): Promise<string> => {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlHours * 3600_000),
  });
  // Housekeeping: forget sessions that expired more than a day ago.
  await db.execute(sql`delete from sessions where expires_at < now() - interval '1 day'`);
  return token;
};

type SessionRow = {
  session_id: string;
  id: string;
  username: string;
  display_name: string;
  role: Role;
};

/** Valid = exists, not revoked, not expired, user still active. */
export const findSession = async (
  db: Db,
  token: string,
): Promise<{ user: AuthUser; sessionId: string } | undefined> => {
  const r = await db.execute<SessionRow>(sql`
    select s.id as session_id, u.id, u.username, u.display_name, u.role::text as role
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)}
      and s.revoked_at is null and s.expires_at > now() and u.active
  `);
  const row = r.rows[0];
  if (!row) return undefined;
  return {
    sessionId: row.session_id,
    user: { id: row.id, username: row.username, displayName: row.display_name, role: row.role },
  };
};

export const revokeSession = async (db: Db, token: string): Promise<void> => {
  await db.execute(
    sql`update sessions set revoked_at = now() where token_hash = ${hashToken(token)} and revoked_at is null`,
  );
};
