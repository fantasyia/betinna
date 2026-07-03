import { useSyncExternalStore, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  useRole,
  hasPermission,
  moduloDaRota,
  useModulo,
  type Permission,
} from '@/hooks/usePermission';
import { isInitializing, subscribeInitializing } from '@/lib/auth-store';
import { OnboardingTour } from '@/components/OnboardingTour';

/**
 * ProtectedRoute — Sprint 4 FIX 6.
 *
 * Bloqueia acesso a rotas baseado em permissão da matriz RBAC.
 *
 * - Sem auth → redireciona para /login (preservando `from` pra retornar depois)
 * - Auth mas sem permissão → redireciona para /403
 * - Auth + permissão (ou sem restrição de permissão) → renderiza children
 *
 * Uso:
 *   // Por permissão (único mecanismo suportado):
 *   <ProtectedRoute requirePermission="admin.panel">
 *     <AdminPage />
 *   </ProtectedRoute>
 *
 *   // Sem restrição de permissão (só exige autenticação):
 *   <ProtectedRoute>
 *     <DashboardPage />
 *   </ProtectedRoute>
 */

interface ProtectedRouteProps {
  children: ReactNode;
  /** Permission específica que o user deve ter (via PERMISSION_MATRIX). */
  requirePermission?: Permission;
}

export function ProtectedRoute({
  children,
  requirePermission,
}: ProtectedRouteProps) {
  const role = useRole();
  const location = useLocation();
  // Permissão DINÂMICA de módulo (painel granular + override por usuário).
  // Derivada do pathname — sub-rotas herdam pelo prefixo. Reativa: se o admin
  // revogar o módulo enquanto o usuário está na página, o store atualiza e
  // este componente redireciona pra /403 (sem página vazia/bug).
  const modulo = moduloDaRota(location.pathname);
  const permModulo = useModulo(modulo);
  // Bootstrap em curso: o SDK do Supabase está restaurando sessão do localStorage.
  // Mostra placeholder em vez de redirecionar pro /login (que apareceria por
  // ~200ms em todo F5 — UX péssima).
  const booting = useSyncExternalStore(subscribeInitializing, isInitializing, isInitializing);

  if (booting) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#888',
          fontSize: 14,
        }}
        data-testid="auth-bootstrap"
      >
        Carregando…
      </div>
    );
  }

  // Não autenticado → login
  if (!role) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check permission (matriz fixa de UI)
  if (requirePermission && !hasPermission(role, requirePermission)) {
    return <Navigate to="/403" replace />;
  }

  // Check de módulo (matriz VIVA do painel granular)
  if (modulo && !permModulo.ver) {
    return <Navigate to="/403" replace />;
  }

  return (
    <>
      {children}
      <OnboardingTour />
    </>
  );
}
