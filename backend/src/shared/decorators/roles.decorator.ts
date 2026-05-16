import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restringe acesso ao endpoint a determinados papéis.
 * @example
 *   @Roles('ADMIN', 'GERENTE')
 *   @Get('config')
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
