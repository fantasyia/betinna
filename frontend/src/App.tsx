import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ProtectedRoute } from '@/components/ProtectedRoute';

/**
 * App router — Sprint 4 FIX 5 + FIX 6.
 *
 * - `createBrowserRouter` (NÃO hash router) per spec.
 * - Code splitting via React.lazy em cada página.
 * - `ErrorBoundary` wrappping cada rota.
 * - Rotas privadas passam por `ProtectedRoute` (role-based redirect /403).
 */

// Lazy-loaded pages — code splitting per route
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const WhatsAppPage = lazy(() => import('@/pages/WhatsAppPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const FidelidadePage = lazy(() => import('@/pages/FidelidadePage'));
const ForbiddenPage = lazy(() => import('@/pages/ForbiddenPage'));

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          data-testid="page-suspense"
          style={{ padding: '4rem', textAlign: 'center', fontFamily: 'system-ui' }}
        >
          Carregando…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/login" replace />,
  },
  {
    path: '/login',
    element: (
      <ErrorBoundary>
        <PageSuspense>
          <LoginPage />
        </PageSuspense>
      </ErrorBoundary>
    ),
  },
  {
    path: '/403',
    element: (
      <ErrorBoundary>
        <PageSuspense>
          <ForbiddenPage />
        </PageSuspense>
      </ErrorBoundary>
    ),
  },
  {
    path: '/dashboard',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <DashboardPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/whatsapp',
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="whatsapp.empresa">
          <PageSuspense>
            <WhatsAppPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/admin',
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="admin.panel">
          <PageSuspense>
            <AdminPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/admin/*',
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="admin.panel">
          <PageSuspense>
            <AdminPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/fidelidade',
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="fidelidade.view">
          <PageSuspense>
            <FidelidadePage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  // 404 — qualquer rota desconhecida
  {
    path: '*',
    element: <Navigate to="/dashboard" replace />,
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
