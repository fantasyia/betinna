import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  PERMISSIONS_KEY,
  type PermissionRequirement,
} from '@shared/decorators/permissions.decorator';
import { ForbiddenException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { PermissionsService } from '@modules/permissions/permissions.service';

/**
 * Verifica permissões granulares (módulo + ação) por papel do usuário.
 * ADMIN sempre passa. Demais papéis são checados via PermissionsService.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionRequirement[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user) throw new UnauthorizedException();

    if (request.user.role === 'ADMIN') return true;

    for (const req of required) {
      const allowed = await this.permissions.userCan(request.user.role, req.module, req.action);
      if (!allowed) {
        throw new ForbiddenException(
          `Permissão necessária: ${req.module}.${req.action}`,
          ErrorCode.INSUFFICIENT_PERMISSIONS,
        );
      }
    }
    return true;
  }
}
