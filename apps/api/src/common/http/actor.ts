import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

export interface Actor {
  sub: string;
  sid: string;
  exp: number;
}
export type ApiRequest = Request & { actor?: Actor };
export const Current = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  const actor = context.switchToHttp().getRequest<ApiRequest>().actor;
  if (!actor) throw new UnauthorizedException();
  return actor;
});
