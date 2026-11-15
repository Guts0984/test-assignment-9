import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type DbHandle, dummyHash, verifyPassword } from '@app/db';
import type { LoginBody, Me } from '@app/shared';
import { AppError } from '../common/errors';
import { unauthenticated } from '../common/errors';
import { DB, ENV, RATE_LIMITERS } from '../common/tokens';
import type { Env } from '../env';
import type { Limiters } from '../rate-limit/limiters';
import { createSession, revokeSession } from './session';

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: Me['role'];
  password_hash: string;
};

const tooMany = (retryAfterSec: number, message = 'Too many attempts, try again later') =>
  new AppError(429, 'RATE_LIMITED', message, undefined, { 'Retry-After': String(retryAfterSec) });

@Injectable()
export class AuthService {
  private inFlight = 0;

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(RATE_LIMITERS) private readonly limiters: Limiters,
  ) {}

  async login(body: LoginBody, ipKey: string): Promise<{ token: string; me: Me }> {
    // 1. cheap, in-memory checks first (no hashing, no database)
    const byIp = this.limiters.loginIp.take(ipKey);
    if (!byIp.allowed) throw tooMany(byIp.retryAfterSec);
    const byUser = this.limiters.loginUser.take(`${ipKey}|${body.username.toLowerCase()}`);
    if (!byUser.allowed) throw tooMany(byUser.retryAfterSec);

    // 2. scrypt is expensive: cap how many run at once so a flood cannot starve the rest of the API
    if (this.inFlight >= this.env.LOGIN_MAX_CONCURRENCY)
      throw tooMany(1, 'Server is busy, retry shortly');
    this.inFlight++;
    try {
      const result = await this.handle.db.execute<UserRow>(sql`
        select id, username, display_name, role::text as role, password_hash
        from users where lower(username) = lower(${body.username}) and active
      `);
      const user = result.rows[0];
      // Same work whether or not the user exists → no timing oracle for usernames.
      const ok = await verifyPassword(body.password, user ? user.password_hash : await dummyHash);
      if (!user || !ok) throw unauthenticated('Invalid username or password');

      const token = await createSession(this.handle.db, user.id, this.env.SESSION_TTL_HOURS);
      return {
        token,
        me: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
        },
      };
    } finally {
      this.inFlight--;
    }
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await revokeSession(this.handle.db, token);
  }
}
