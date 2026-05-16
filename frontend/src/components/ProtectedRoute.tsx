import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useRole, hasPermission, type Permission } from '@/hooks/usePermission';
import type { UserRole } from '@/types/auth';

/**
 * ProtectedRoute — Sprint 4 FIX 6.
 *
 * Bloqueia acesso a rotas baseado em role OU permission.
 *
 * - Sem auth → redireciona para /login (preservando `from` pra retornar depois)
 * - Auth mas sem permissão → redireciona para /403
 * - Auth + permissão → renderiza children
 *
 * Uso:
 *   // Por permissão (preferido — granularidade):
 *   <ProtectedRoute requirePermission="admin.panel">
 *     <AdminPage />
 *   </ProtectedRoute>
 *
 *   // Por role (compatibilidade — quando módulo inteiro pertence a 1 role):
 *   <ProtectedRoute allowedRoles={['ADMIN', 'DIRECTOR']}>
 *     <FidelidadePage />
 *   </ProtectedRoute>
 */

interface ProtectedRouteProps {
  children: ReactNode;
  /** Lista de roles permitidos. Use junto com requirePermission ou sozinho. */
  allowedRoles?: UserRole[];
  /** Permission específica que o user deve ter. */
  requirePermission?: Permission;
}

export function ProtectedRoute({
  children,
  allowedRoles,
  requirePermission,
}: ProtectedRouteProps) {
  const role = useRole();
  const location = useLocation();

  // Não autenticado → login
  if (!role) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check role
  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/403" replace />;
  }

  // Check permission
  if (requirePermission && !hasPermission(role, requirePermission)) {
    return <Navigate to="/403" replace />;
  }

  return <>{children}</>;
}
