import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { type AuthSession } from '@relay/shared';
import { z } from 'zod';
import { ENV, type Env } from '../config/environment.js';
import { ApiJsonBody } from '../common/http/api-json-body.decorator.js';
import { SchemaPipe } from '../common/http/schema.pipe.js';
import { RedisService } from '../redis/redis.service.js';
import { loginSchema, registerSchema } from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { Public } from './public.decorator.js';
const cookieName = 'relay_refresh';
const cookiePath = '/api/v1/auth';
@Controller('auth')
@ApiTags('auth')
@Public()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {}
  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: cookiePath,
    };
  }
  private cookie(req: Request): string | undefined {
    const token = (req.cookies as Record<string, unknown> | undefined)?.[cookieName];
    return typeof token === 'string' ? token : undefined;
  }
  private async csrf(req: Request) {
    const origin = req.headers.origin;
    if (origin && !this.env.CORS_ORIGINS.includes(origin))
      throw new UnauthorizedException('Origin is not allowed');
    await this.redis.rate(
      'auth:ip:' + (req.ip ?? req.socket.remoteAddress ?? 'unknown'),
      40,
      60000,
      randomUUID(),
    );
  }
  private set(res: Response, value: { session: AuthSession; refreshToken: string }) {
    res.setHeader('cache-control', 'no-store');
    res.cookie(cookieName, value.refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.env.REFRESH_TTL_SECONDS * 1000,
    });
    return value.session;
  }
  @Post('register')
  @ApiJsonBody(registerSchema)
  async register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new SchemaPipe(registerSchema)) body: z.infer<typeof registerSchema>,
  ) {
    await this.csrf(req);
    return this.set(res, await this.auth.register(body));
  }
  @Post('login')
  @HttpCode(200)
  @ApiJsonBody(loginSchema)
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new SchemaPipe(loginSchema)) body: z.infer<typeof loginSchema>,
  ) {
    await this.csrf(req);
    return this.set(res, await this.auth.login(body, req.ip ?? 'unknown'));
  }
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.csrf(req);
    const token = this.cookie(req);
    if (!token) throw new UnauthorizedException('Refresh cookie required');
    try {
      return this.set(res, await this.auth.rotate(token));
    } catch (error) {
      if (error instanceof UnauthorizedException) res.clearCookie(cookieName, this.cookieOptions());
      throw error;
    }
  }
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.csrf(req);
    await this.auth.logout(this.cookie(req));
    res.clearCookie(cookieName, this.cookieOptions());
  }
}
