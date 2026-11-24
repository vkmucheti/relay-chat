import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { type ApiRequest } from '../common/http/actor.js';
import { RedisService } from '../redis/redis.service.js';
import { AuthService } from './auth.service.js';
import { publicKey } from './public.decorator.js';
@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly redis: RedisService,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    if (ctx.getType() !== 'http') return true;
    if (this.reflector.getAllAndOverride<boolean>(publicKey, [ctx.getHandler(), ctx.getClass()]))
      return true;
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Bearer token required');
    req.actor = await this.auth.authenticate(match[1]);
    const nonce = randomUUID();
    await Promise.all([
      this.redis.rate('http:user:' + req.actor.sub, 240, 60000, nonce),
      this.redis.rate(
        'http:ip:' + (req.ip ?? req.socket.remoteAddress ?? 'unknown'),
        600,
        60000,
        nonce,
      ),
    ]);
    return true;
  }
}
