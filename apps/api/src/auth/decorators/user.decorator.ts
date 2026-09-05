import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { HttpRequest } from '@app-types/http.type';
import type { AuthUser } from '@app-types/user-auth.type';

/** 取出 AuthGuard 塞進 request 的登入者 */
export const User = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<HttpRequest>();
  if (!req.user) throw new UnauthorizedException('No authenticated user on request');
  return req.user;
});

export type { AuthUser };
