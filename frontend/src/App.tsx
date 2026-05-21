import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { PwaBanner } from '@/components/PwaBanner';

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
const ForbiddenPage = lazy(() => import('@/pages/ForbiddenPage'));
const ClientesPage = lazy(() => import('@/pages/ClientesPage'));
const ClienteDetailPage = lazy(() => import('@/pages/ClienteDetailPage'));
const CatalogoPage = lazy(() => import('@/pages/CatalogoPage'));
const MullerBotPage = lazy(() => import('@/pages/MullerBotPage'));
const PersonaBotPage = lazy(() => import('@/pages/PersonaBotPage'));
const FormulariosPage = lazy(() => import('@/pages/FormulariosPage'));
const FormularioPublicoPage = lazy(() => import('@/pages/FormularioPublicoPage'));
const NpsPage = lazy(() => import('@/pages/NpsPage'));
const NpsPublicoPage = lazy(() => import('@/pages/NpsPublicoPage'));
const MetasPage = lazy(() => import('@/pages/MetasPage'));
const SegmentosPage = lazy(() => import('@/pages/SegmentosPage'));
const MarketplaceIncidentsPage = lazy(() => import('@/pages/MarketplaceIncidentsPage'));
const ConfiguracoesPage = lazy(() => import('@/pages/ConfiguracoesPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const TagsPage = lazy(() => import('@/pages/TagsPage'));
const FluxosPage = lazy(() => import('@/pages/FluxosPage'));
const FluxoTemplatesPage = lazy(() => import('@/pages/FluxoTemplatesPage'));
const CampanhasPage = lazy(() => import('@/pages/CampanhasPage'));
const PermissoesPage = lazy(() => import('@/pages/PermissoesPage'));
const RelatoriosPage = lazy(() => import('@/pages/RelatoriosPage'));
const PedidosPage = lazy(() => import('@/pages/PedidosPage'));
const PedidoDetailPage = lazy(() => import('@/pages/PedidoDetailPage'));
const FunisPage = lazy(() => import('@/pages/FunisPage'));
const ComissoesPage = lazy(() => import('@/pages/ComissoesPage'));
const LeadsPage = lazy(() => import('@/pages/LeadsPage'));
const PropostasPage = lazy(() => import('@/pages/PropostasPage'));
const AmostrasPage = lazy(() => import('@/pages/AmostrasPage'));
const OcorrenciasPage = lazy(() => import('@/pages/OcorrenciasPage'));
const ProdutosPage = lazy(() => import('@/pages/ProdutosPage'));
const AgendaPage = lazy(() => import('@/pages/AgendaPage'));
const AprovacoesPage = lazy(() => import('@/pages/AprovacoesPage'));
const InboxPage = lazy(() => import('@/pages/InboxPage'));
const IntegracoesPage = lazy(() => import('@/pages/IntegracoesPage'));
const MinhasIntegracoesPage = lazy(() => import('@/pages/MinhasIntegracoesPage'));
const NotificacoesPage = lazy(() => import('@/pages/NotificacoesPage'));

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
    // Página pública — sem auth, sem layout. Rota /f/:slug.
    path: '/f/:slug',
    element: (
      <ErrorBoundary>
        <PageSuspense>
          <FormularioPublicoPage />
        </PageSuspense>
      </ErrorBoundary>
    ),
  },
  {
    // NPS público em /n/:slug
    path: '/n/:slug',
    element: (
      <ErrorBoundary>
        <PageSuspense>
          <NpsPublicoPage />
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
    path: '/notificacoes',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <NotificacoesPage />
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
    path: '/clientes',
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="clientes.view">
          <PageSuspense>
            <ClientesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/clientes/:id',
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="clientes.view">
          <PageSuspense>
            <ClienteDetailPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/catalogo',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <CatalogoPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/mullerbot',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <MullerBotPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/mullerbot/persona',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN', 'DIRECTOR']}>
          <PageSuspense>
            <PersonaBotPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/incidentes',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN', 'DIRECTOR', 'GERENTE', 'SAC']}>
          <PageSuspense>
            <MarketplaceIncidentsPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/configuracoes',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN']}>
          <PageSuspense>
            <ConfiguracoesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/perfil',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <ProfilePage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/usuarios',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN', 'DIRECTOR', 'GERENTE']}>
          <PageSuspense>
            <ProfilePage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/usuarios/:id',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN', 'DIRECTOR', 'GERENTE']}>
          <PageSuspense>
            <ProfilePage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/tags',
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="clientes.view">
          <PageSuspense>
            <TagsPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/fluxos',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN', 'DIRECTOR', 'GERENTE']}>
          <PageSuspense>
            <FluxosPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/fluxos/templates',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN', 'DIRECTOR', 'GERENTE']}>
          <PageSuspense>
            <FluxoTemplatesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/campanhas',
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="campanhas.view">
          <PageSuspense>
            <CampanhasPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/permissoes',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN']}>
          <PageSuspense>
            <PermissoesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/relatorios',
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="relatorios.view">
          <PageSuspense>
            <RelatoriosPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/pedidos',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <PedidosPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/pedidos/:id',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <PedidoDetailPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/leads',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <LeadsPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/funis',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <FunisPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/formularios',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN', 'DIRECTOR', 'GERENTE']}>
          <PageSuspense>
            <FormulariosPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/nps',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN', 'DIRECTOR', 'GERENTE']}>
          <PageSuspense>
            <NpsPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/metas',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <MetasPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/segmentos',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN', 'DIRECTOR', 'GERENTE']}>
          <PageSuspense>
            <SegmentosPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/propostas',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <PropostasPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/amostras',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <AmostrasPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/ocorrencias',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <OcorrenciasPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/produtos',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <ProdutosPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/agenda',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <AgendaPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/aprovacoes',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <AprovacoesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/inbox',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <InboxPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/integracoes',
    element: (
      <ErrorBoundary>
        <ProtectedRoute allowedRoles={['ADMIN', 'DIRECTOR', 'GERENTE']}>
          <PageSuspense>
            <IntegracoesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/minhas-integracoes',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <MinhasIntegracoesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: '/comissoes',
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <ComissoesPage />
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
  return (
    <>
      <RouterProvider router={router} />
      <PwaBanner />
    </>
  );
}
