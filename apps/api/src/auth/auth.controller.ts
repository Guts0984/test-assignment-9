import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { LoginBody, Me } from '@app/shared';
import { Endpoint } from '../common/endpoint';
import type { AppRequest, AppResponse } from '../common/request';
import { ENV } from '../common/tokens';
import { unauthenticated } from '../common/errors';
import type { Env } from '../env';
import { clientKey } from '../rate-limit/client-ip';
import { AuthService } from './auth.service';
import { clearedSessionCookie, readSessionToken, sessionCookie } from './session';

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  @Endpoint({
    access: 'public',
    tag: 'Auth',
    summary: 'Log in; sets an httpOnly session cookie',
    body: LoginBody,
    response: Me,
  })
  async login(
    @Body() body: LoginBody,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: AppResponse,
  ): Promise<Me> {
    const { token, me } = await this.auth.login(body, clientKey(req.ip));
    res.setHeader(
      'Set-Cookie',
      sessionCookie(token, this.env.COOKIE_SECURE, this.env.SESSION_TTL_HOURS),
    );
    res.setHeader('Cache-Control', 'no-store');
    return me;
  }

  @Post('auth/logout')
  @HttpCode(204)
  @Endpoint({
    access: 'public',
    tag: 'Auth',
    summary: 'Log out; revokes the session server-side',
    status: 204,
  })
  async logout(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: AppResponse,
  ): Promise<void> {
    await this.auth.logout(readSessionToken(req.headers.cookie, this.env.COOKIE_SECURE));
    res.setHeader('Set-Cookie', clearedSessionCookie(this.env.COOKIE_SECURE));
  }

  @Get('me')
  @Endpoint({ access: 'any', tag: 'Auth', summary: 'Current user', response: Me })
  me(@Req() req: AppRequest, @Res({ passthrough: true }) res: AppResponse): Me {
    if (!req.user) throw unauthenticated();
    res.setHeader('Cache-Control', 'no-store');
    return req.user;
  }
}
