import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { ROLES_KEY } from '@shared/decorators/roles.decorator';
import { ForbiddenException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

/**
 * Restringe acesso aos papéis indicados em `@Roles(...)`.
 * Deve rodar APÓS o AuthGuard (que popula `req.user`).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user) throw new UnauthorizedException();

    if (!required.includes(request.user.role)) {
      throw new ForbiddenException(
        `Acesso restrito aos papéis: ${required.join(', ')}`,
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }
    return true;
  }
}
