import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * Extrai o `empresaId` ativo do usuário autenticado.
 * NUNCA aceita empresaId vindo do body/query — sempre da identidade do JWT.
 *
 * Lança ForbiddenException se o usuário não tem empresa ativa.
 */
export function getCallerEmpresaId(user: AuthenticatedUser): string {
  if (!user?.empresaIdAtiva) {
    throw new ForbiddenException(
      'Empresa não definida para esta requisição',
      ErrorCode.TENANT_ACCESS_DENIED,
    );
  }
  return user.empresaIdAtiva;
}

/**
 * ADMIN tem acesso global (vê/edita em qualquer tenant).
 * DIRECTOR/GERENTE/SAC/REP ficam restritos à empresa ativa.
 *
 * Use isso para decidir se aplicar filtro `where: { empresaId }` ou não.
 */
export function isGlobalAdmin(user: AuthenticatedUser): boolean {
  return user.role === 'ADMIN';
}

/**
 * Retorna o filtro de empresa para queries Prisma.
 * - ADMIN: undefined (sem filtro — vê tudo)
 * - Demais: empresaIdAtiva (restrito)
 *
 * Uso:
 *   const where = { ...empresaFilter(user) };
 *   prisma.model.findMany({ where });
 */
export function empresaFilter(user: AuthenticatedUser): { empresaId?: string } {
  if (isGlobalAdmin(user)) return {};
  return { empresaId: getCallerEmpresaId(user) };
}
