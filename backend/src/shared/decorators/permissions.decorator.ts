import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Define qual permissão (módulo + ação) é necessária para acessar o endpoint.
 *
 * Convenção de ação: 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export'
 *
 * @example
 *   @RequirePermissions({ module: 'clientes', action: 'edit' })
 *   @Patch(':id')
 */
export interface PermissionRequirement {
  module: string;
  action: 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export';
}

export const RequirePermissions = (
  ...permissions: PermissionRequirement[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);
