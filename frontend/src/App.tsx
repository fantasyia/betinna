import { Suspense } from "react";
import { lazyComRetry } from "@/lib/lazy-com-retry";
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
  useParams,
} from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PwaBanner } from "@/components/PwaBanner";

/**
 * App router — Sprint 4 FIX 5 + FIX 6.
 *
 * - `createBrowserRouter` (NÃO hash router) per spec.
 * - Code splitting via React.lazy em cada página.
 * - `ErrorBoundary` wrappping cada rota.
 * - Rotas privadas passam por `ProtectedRoute` (role-based redirect /403).
 */

// Lazy-loaded pages — code splitting per route
const LoginPage = lazyComRetry(() => import("@/pages/LoginPage"));
const WelcomePage = lazyComRetry(() => import("@/pages/WelcomePage"));
const PropostaAceitePage = lazyComRetry(() => import("@/pages/PropostaAceitePage"));
const LevantamentoCampoPage = lazyComRetry(() => import("@/pages/LevantamentoCampoPage"));
const TreinamentosPage = lazyComRetry(() => import("@/pages/TreinamentosPage"));
const DashboardPage = lazyComRetry(() => import("@/pages/DashboardPage"));
const KanbanBoardsPage = lazyComRetry(() => import("@/pages/kanban/KanbanBoardsPage"));
const CalendarioMarketingPage = lazyComRetry(
  () => import("@/pages/CalendarioMarketingPage"),
);
const KanbanBoardPage = lazyComRetry(() => import("@/pages/kanban/KanbanBoardPage"));
const TokensApiPage = lazyComRetry(() => import("@/pages/TokensApiPage"));
const MeusItensPage = lazyComRetry(() => import("@/pages/kanban/MeusItensPage"));
const WhatsAppPage = lazyComRetry(() => import("@/pages/WhatsAppPage"));
const AdminPage = lazyComRetry(() => import("@/pages/AdminPage"));
const ForbiddenPage = lazyComRetry(() => import("@/pages/ForbiddenPage"));
const ClientesPage = lazyComRetry(() => import("@/pages/ClientesPage"));
const ContatosPage = lazyComRetry(() => import("@/pages/ContatosPage"));
const ClienteDetailPage = lazyComRetry(() => import("@/pages/ClienteDetailPage"));
const CatalogoPage = lazyComRetry(() => import("@/pages/CatalogoPage"));
const MullerBotPage = lazyComRetry(() => import("@/pages/MullerBotPage"));
const PersonaBotPage = lazyComRetry(() => import("@/pages/PersonaBotPage"));
const PromptsBotPage = lazyComRetry(() => import("@/pages/PromptsBotPage"));
const KnowledgePage = lazyComRetry(() => import("@/pages/KnowledgePage"));
const BotAuditoriaPage = lazyComRetry(() => import("@/pages/BotAuditoriaPage"));
const RespostasRapidasPage = lazyComRetry(() => import("@/pages/RespostasRapidasPage"));
const MetasPage = lazyComRetry(() => import("@/pages/MetasPage"));
const SegmentosPage = lazyComRetry(() => import("@/pages/SegmentosPage"));
const MarketplaceIncidentsPage = lazyComRetry(
  () => import("@/pages/MarketplaceIncidentsPage"),
);
const ConfiguracoesPage = lazyComRetry(() => import("@/pages/ConfiguracoesPage"));
const ProfilePage = lazyComRetry(() => import("@/pages/ProfilePage"));
const TagsPage = lazyComRetry(() => import("@/pages/TagsPage"));
const FluxosPage = lazyComRetry(() => import("@/pages/FluxosPage"));
const FluxoTemplatesPage = lazyComRetry(() => import("@/pages/FluxoTemplatesPage"));
const MonitorPage = lazyComRetry(() => import("@/pages/MonitorPage"));
const CampanhasPage = lazyComRetry(() => import("@/pages/CampanhasPage"));
const PermissoesPage = lazyComRetry(() => import("@/pages/PermissoesPage"));
const RelatoriosPage = lazyComRetry(() => import("@/pages/RelatoriosPage"));
const PedidosPage = lazyComRetry(() => import("@/pages/PedidosPage"));
const PedidoDetailPage = lazyComRetry(() => import("@/pages/PedidoDetailPage"));
const FunisPage = lazyComRetry(() => import("@/pages/FunisPage"));
const ComissoesPage = lazyComRetry(() => import("@/pages/ComissoesPage"));
const LeadsPage = lazyComRetry(() => import("@/pages/LeadsPage"));
const PropostasPage = lazyComRetry(() => import("@/pages/PropostasPage"));
const ContratosPage = lazyComRetry(() => import("@/pages/ContratosPage"));
const AmostrasPage = lazyComRetry(() => import("@/pages/AmostrasPage"));
const MateriaisPage = lazyComRetry(() => import("@/pages/MateriaisPage"));
const DevolucoesPage = lazyComRetry(() => import("@/pages/DevolucoesPage"));
const InboxInternaPage = lazyComRetry(() => import("@/pages/InboxInternaPage"));
const OcorrenciasPage = lazyComRetry(() => import("@/pages/OcorrenciasPage"));
const ProdutosPage = lazyComRetry(() => import("@/pages/ProdutosPage"));
const AgendaPage = lazyComRetry(() => import("@/pages/AgendaPage"));
const AprovacoesPage = lazyComRetry(() => import("@/pages/AprovacoesPage"));
const InboxPage = lazyComRetry(() => import("@/pages/InboxPage"));
const IntegracoesPage = lazyComRetry(() => import("@/pages/IntegracoesPage"));
const MinhasIntegracoesPage = lazyComRetry(
  () => import("@/pages/MinhasIntegracoesPage"),
);
const NotificacoesPage = lazyComRetry(() => import("@/pages/NotificacoesPage"));

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          data-testid="page-suspense"
          style={{
            padding: "4rem",
            textAlign: "center",
            fontFamily: "system-ui",
          }}
        >
          Carregando…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/** Compat de links antigos: /ocorrencias/:id → /ocorrencias?highlight=:id. */
function RedirectOcorrencia() {
  const { id } = useParams();
  return (
    <Navigate to={`/ocorrencias${id ? `?highlight=${id}` : ""}`} replace />
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/login",
    element: (
      <ErrorBoundary>
        <PageSuspense>
          <LoginPage />
        </PageSuspense>
      </ErrorBoundary>
    ),
  },
  {
    // Página pública — finalização do convite (token no hash).
    path: "/welcome",
    element: (
      <ErrorBoundary>
        <PageSuspense>
          <WelcomePage />
        </PageSuspense>
      </ErrorBoundary>
    ),
  },
  {
    // C3 — Página pública de aceite de proposta (token na URL, sem login).
    path: "/proposta/aceite/:token",
    element: (
      <ErrorBoundary>
        <PageSuspense>
          <PropostaAceitePage />
        </PageSuspense>
      </ErrorBoundary>
    ),
  },
  {
    path: "/403",
    element: (
      <ErrorBoundary>
        <PageSuspense>
          <ForbiddenPage />
        </PageSuspense>
      </ErrorBoundary>
    ),
  },
  {
    path: "/dashboard",
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
    path: "/notificacoes",
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
    path: "/whatsapp",
    element: (
      <ErrorBoundary>
        {/* SEM requirePermission: esta página tem DUAS abas e a própria página
            decide qual mostrar — "Número da empresa" só pra ADMIN/DIRECTOR/SAC,
            "Meu WhatsApp pessoal" pra qualquer um. Exigir `whatsapp.empresa` no
            guard trancava o REP na porta: o card "WhatsApp pessoal" em Minhas
            Integrações aponta pra cá, e o clique caía em /403 — ou seja, quem o
            recurso existe pra atender era justamente quem não conseguia parear.
            O backend não gateia por papel em /usuario/integracoes/whatsapp/*. */}
        <ProtectedRoute>
          <PageSuspense>
            <WhatsAppPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/admin",
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
    path: "/admin/*",
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
    path: "/clientes",
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
    path: "/contatos",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="clientes.view">
          <PageSuspense>
            <ContatosPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/clientes/:id",
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
    path: "/catalogo",
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
    path: "/mullerbot",
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
    path: "/mullerbot/persona",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="mullerbot.config">
          <PageSuspense>
            <PersonaBotPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/mullerbot/prompts",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="mullerbot.config">
          <PageSuspense>
            <PromptsBotPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/mullerbot/conhecimento",
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <KnowledgePage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/mullerbot/auditoria",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="mullerbot.auditoria">
          <PageSuspense>
            <BotAuditoriaPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/respostas-rapidas",
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <RespostasRapidasPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/incidentes",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="incidentes.view">
          <PageSuspense>
            <MarketplaceIncidentsPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/configuracoes",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="configuracoes.empresa">
          <PageSuspense>
            <ConfiguracoesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/perfil",
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
    path: "/usuarios",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="usuarios.view">
          <PageSuspense>
            <ProfilePage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/usuarios/:id",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="usuarios.view">
          <PageSuspense>
            <ProfilePage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/tags",
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
    path: "/fluxos",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="fluxos.view">
          <PageSuspense>
            <FluxosPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/fluxos/templates",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="fluxos.view">
          <PageSuspense>
            <FluxoTemplatesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/fluxos/monitor",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="fluxos.view">
          <PageSuspense>
            <MonitorPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/campanhas",
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
    path: "/permissoes",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="permissoes.view">
          <PageSuspense>
            <PermissoesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/relatorios",
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
    path: "/pedidos",
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
    path: "/pedidos/:id",
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
    path: "/leads",
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
    path: "/kanban",
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <KanbanBoardsPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/calendario-marketing",
    element: (
      <ErrorBoundary>
        <ProtectedRoute bloquearPara={["REP"]}>
          <PageSuspense>
            <CalendarioMarketingPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    // Tokens de API do MCP moraram em /kanban/tokens até 21/08. Saíram de lá
    // porque o escopo deles nunca foi só o quadro (fluxos, funis, CRM, inbox…)
    // e configuração de acesso pertence a Sistema, junto do resto.
    path: "/configuracoes/tokens",
    element: (
      <ErrorBoundary>
        {/* Sem `requirePermission`: o gate vem do mapa ROUTE_MODULO
            (/configuracoes/tokens → `quadros`), que é como o backend gateia
            estes endpoints. Senão a tela abre e a chamada volta 403. */}
        <ProtectedRoute>
          <PageSuspense>
            <TokensApiPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    // Endereço antigo: quem tem link salvo (ou o passo a passo do MCP colado
    // num README) não pode cair num 404.
    path: "/kanban/tokens",
    element: <Navigate to="/configuracoes/tokens" replace />,
  },
  {
    path: "/kanban/meus-itens",
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <MeusItensPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/kanban/:boardId",
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <KanbanBoardPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/funis",
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
    path: "/metas",
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
    path: "/segmentos",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="segmentos.view">
          <PageSuspense>
            <SegmentosPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/treinamentos",
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <TreinamentosPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/levantamento",
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <LevantamentoCampoPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/propostas",
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
    path: "/contratos",
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <ContratosPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/amostras",
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
    path: "/materiais",
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <MateriaisPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/devolucoes",
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <DevolucoesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/inbox-interna",
    element: (
      <ErrorBoundary>
        <ProtectedRoute>
          <PageSuspense>
            <InboxInternaPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/ocorrencias",
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
    // Notificações ANTIGAS já gravadas apontam pra /ocorrencias/:id, que não
    // existia — o catch-all mandava pro dashboard e o ticket sumia. Redireciona
    // pro formato que a página consome (?highlight=).
    path: "/ocorrencias/:id",
    element: <RedirectOcorrencia />,
  },
  {
    path: "/produtos",
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
    path: "/agenda",
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
    path: "/aprovacoes",
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
    path: "/inbox",
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
    path: "/integracoes",
    element: (
      <ErrorBoundary>
        <ProtectedRoute requirePermission="integracoes.view">
          <PageSuspense>
            <IntegracoesPage />
          </PageSuspense>
        </ProtectedRoute>
      </ErrorBoundary>
    ),
  },
  {
    path: "/minhas-integracoes",
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
    path: "/comissoes",
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
    path: "*",
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
