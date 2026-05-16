import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { UnauthorizedException } from '../errors/app-exception';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Injeta o usuário autenticado no método do controller.
 * Lança UnauthorizedException se não houver usuário (defesa em profundidade).
 *
 * @example
 *   @Get('me')
 *   getMe(@CurrentUser() user: AuthenticatedUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.user) {
      throw new UnauthorizedException();
    }
    return request.user;
  },
);
