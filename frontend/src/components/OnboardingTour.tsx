import { useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserRole } from '@/types/auth';
import { getSession, subscribe } from '@/lib/auth-store';
import { btn, btnSecondary, colors } from '@/components/styles';

/**
 * OnboardingTour — passo-a-passo introdutório por papel.
 *
 * - Auto-aparece no 1º login (flag por user+role em localStorage)
 * - Pode ser re-disparado manualmente (`startOnboarding()` exportada)
 * - Step navegável: Anterior / Próximo / Pular tudo
 * - Cada step pode opcionalmente navegar pra rota relacionada
 *
 * Estado fica em localStorage:
 *   onboarding:done:<userId>:<role> = "1"
 */

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface Step {
  title: string;
  body: string;
  /** Rota opcional pra navegar quando user chegar nesse step */
  route?: string;
  /** Emoji ou ícone simples no header */
  icon?: string;
}

// ─── Steps por papel ───────────────────────────────────────────────────────

const STEPS_ADMIN: Step[] = [
  {
    icon: '👋',
    title: 'Bem-vindo, ADMIN',
    body: 'Você é o operador da plataforma Betinna.ai. Tem acesso cross-tenant: pode criar empresas, dar suporte a qualquer tenant e gerenciar a dead-letter queue.',
  },
  {
    icon: '🏢',
    title: 'Criar empresas',
    body: 'Em /admin/empresas você cria novos clientes. Cada empresa é um tenant isolado. Depois de criar, convide o DIRECTOR responsável.',
    route: '/admin',
  },
  {
    icon: '🔄',
    title: 'Trocar entre tenants',
    body: 'No topo da tela tem um seletor de empresa ativa — use pra dar suporte ou debugar um tenant específico. Suas ações ficam no audit log.',
  },
  {
    icon: '🛡️',
    title: 'Permissões granulares',
    body: 'A matriz Role × Módulo × Ação está em /permissoes. Você pode customizar permissões por tenant — útil quando um cliente pede regra especial.',
    route: '/permissoes',
  },
  {
    icon: '📚',
    title: 'Documentação completa',
    body: 'A pasta /docs/modules tem detalhes de cada módulo. Use o botão "Reiniciar tour" no seu perfil pra rever isso.',
  },
];

const STEPS_DIRECTOR: Step[] = [
  {
    icon: '👋',
    title: 'Bem-vindo, DIRECTOR',
    body: 'Você é o decisor da sua empresa. Tem controle total dentro do tenant: integrações, regras de comissão, fechamento de mês e dados fiscais.',
  },
  {
    icon: '🔌',
    title: 'Primeiro passo: OMIE',
    body: 'Em /integracoes conecte o OMIE (ERP). É a fonte da verdade fiscal — importa clientes, produtos, preços negociados. Sem OMIE não roda venda.',
    route: '/integracoes',
  },
  {
    icon: '👥',
    title: 'Monte sua equipe',
    body: 'Em /admin convide GERENTEs e REPs. Defina hierarquia (qual REP responde a qual GERENTE). Ajuste teto de desconto e % comissão por usuário.',
    route: '/admin',
  },
  {
    icon: '💰',
    title: 'Comissões',
    body: 'Cron mensal fecha o mês anterior dia 1 às 04:00 UTC. Em /comissoes você confere por rep e marca como pago após a transferência.',
    route: '/comissoes',
  },
  {
    icon: '🎁',
    title: 'Programa fidelidade (opcional)',
    body: 'Em /fidelidade você configura pontos por R$ gasto, validade e catálogo de recompensas. Crédito automático quando pedido aprovado vai pro OMIE.',
    route: '/fidelidade',
  },
  {
    icon: '📊',
    title: 'Relatórios',
    body: 'Em /relatorios você acompanha vendas, funil, comissões, SAC, amostras, fidelidade e campanhas — tudo com variação % vs período anterior.',
    route: '/relatorios',
  },
];

const STEPS_GERENTE: Step[] = [
  {
    icon: '👋',
    title: 'Bem-vindo, GERENTE',
    body: 'Você gerencia uma equipe de REPs. Tudo que enxergar é da sua carteira (REPs subordinados a você).',
  },
  {
    icon: '✅',
    title: 'Aprovações de desconto',
    body: 'Quando um REP da sua equipe dá desconto acima do teto, vem pra você aprovar em /aprovacoes. Aprove ou rejeite com motivo.',
    route: '/aprovacoes',
  },
  {
    icon: '📈',
    title: 'Acompanhe os REPs',
    body: 'Em /relatorios → aba Vendas você vê o desempenho dos seus reps. Identifique queda e atue rápido.',
    route: '/relatorios',
  },
  {
    icon: '💬',
    title: 'Inbox compartilhada',
    body: 'Em /inbox você vê WhatsApp empresa + marketplaces + IG/FB de toda a equipe. Útil pra resolver casos que escalam.',
    route: '/inbox',
  },
];

const STEPS_SAC: Step[] = [
  {
    icon: '👋',
    title: 'Bem-vindo, SAC',
    body: 'Você cuida do atendimento. Tem acesso a todos os canais de conversação e às ocorrências internas.',
  },
  {
    icon: '💬',
    title: 'Inbox unificada',
    body: 'Em /inbox você vê WhatsApp empresa + Messenger + Instagram + ML + Shopee + Amazon + TikTok numa caixa só. Status: pendente → enviada → lida.',
    route: '/inbox',
  },
  {
    icon: '🛒',
    title: 'Incidentes de marketplaces',
    body: 'Reclamações, devoluções e disputas viram /marketplace/incidentes. Filtre por "Aguardando vendedor" pra priorizar.',
    route: '/marketplace/incidentes',
  },
  {
    icon: '🎫',
    title: 'Ocorrências internas',
    body: 'Em /ocorrencias você abre tickets pra problemas operacionais. SLA por severidade (CRITICA=2h, ALTA=4h, MEDIA=24h, BAIXA=72h).',
    route: '/ocorrencias',
  },
];

const STEPS_REP: Step[] = [
  {
    icon: '👋',
    title: 'Bem-vindo, representante',
    body: 'Sua carteira de clientes está aqui. Você cria pedidos, propostas, amostras e atende seus clientes pelo seu WhatsApp.',
  },
  {
    icon: '👥',
    title: 'Seus clientes',
    body: 'Em /clientes você vê apenas os da sua carteira. Pode filtrar por listas dinâmicas: top faturamento, sem pedido 30d, aniversariantes, etc.',
    route: '/clientes',
  },
  {
    icon: '🛍️',
    title: 'Novo pedido',
    body: 'Em /pedidos clique "Novo pedido". Selecione cliente, adicione itens, aplique desconto. Se passar do seu teto, vai pra aprovação do gerente.',
    route: '/pedidos',
  },
  {
    icon: '📕',
    title: 'Seu catálogo personalizado',
    body: 'Em /catalogo você escolhe quais produtos da empresa entram no seu catálogo e aplica markup. Compartilhe o link com clientes via WhatsApp.',
    route: '/catalogo',
  },
  {
    icon: '📱',
    title: 'WhatsApp pessoal',
    body: 'Em /usuario/integracoes/whatsapp pareie seu número. Suas conversas aparecem em /inbox — só você vê (REP não acessa marketplaces da empresa).',
    route: '/usuario/integracoes',
  },
  {
    icon: '🤖',
    title: 'MullerBot',
    body: 'Em /mullerbot pergunte sobre produtos da empresa (ex: "que produto serve pra bolo?"). Precisa configurar sua chave OpenAI antes em /usuario/integracoes.',
    route: '/mullerbot',
  },
  {
    icon: '💰',
    title: 'Sua comissão',
    body: 'Em /comissoes você vê sua linha do mês. % de comissão é definida pelo diretor. Snapshot por pedido — mudança futura não afeta histórico.',
    route: '/comissoes',
  },
];

const STEPS_BY_ROLE: Record<UserRole, Step[]> = {
  ADMIN: STEPS_ADMIN,
  DIRECTOR: STEPS_DIRECTOR,
  GERENTE: STEPS_GERENTE,
  SAC: STEPS_SAC,
  REP: STEPS_REP,
};

// ─── Flag de conclusão ─────────────────────────────────────────────────────

function flagKey(userId: string, role: UserRole) {
  return `onboarding:done:${userId}:${role}`;
}

function isDone(userId: string, role: UserRole): boolean {
  try {
    return localStorage.getItem(flagKey(userId, role)) === '1';
  } catch {
    return true; // localStorage indisponível → assume done (não trava UX)
  }
}

function markDone(userId: string, role: UserRole) {
  try {
    localStorage.setItem(flagKey(userId, role), '1');
  } catch {
    /* ignore */
  }
}

function unmarkDone(userId: string, role: UserRole) {
  try {
    localStorage.removeItem(flagKey(userId, role));
  } catch {
    /* ignore */
  }
}

/**
 * Dispara o tour manualmente (botão "Reiniciar tour" no Profile).
 * Limpa a flag e força re-render do componente.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function startOnboarding() {
  const session = getSession();
  if (!session?.user?.id || !session.user.role) return;
  unmarkDone(session.user.id, session.user.role);
  window.dispatchEvent(new CustomEvent('onboarding:restart'));
}

// ─── Subscribe auth ────────────────────────────────────────────────────────

function subscribeAuth(cb: () => void) {
  return subscribe(() => cb());
}
function getSnapshot() {
  return getSession();
}

// ─── Componente ────────────────────────────────────────────────────────────

export function OnboardingTour() {
  const session = useSyncExternalStore(subscribeAuth, getSnapshot, getSnapshot);
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);
  const [visible, setVisible] = useState(false);

  const user = session?.user;
  const userId = user?.id ?? null;
  const role = user?.role ?? null;

  // Reset visibility quando user muda ou quando "onboarding:restart" dispara
  useEffect(() => {
    if (!userId || !role) {
      setVisible(false);
      return;
    }
    setStepIdx(0);
    setVisible(!isDone(userId, role));
  }, [userId, role]);

  useEffect(() => {
    function onRestart() {
      if (!userId || !role) return;
      setStepIdx(0);
      setVisible(true);
    }
    window.addEventListener('onboarding:restart', onRestart);
    return () => window.removeEventListener('onboarding:restart', onRestart);
  }, [userId, role]);

  if (!visible || !userId || !role) return null;

  const steps = STEPS_BY_ROLE[role];
  const step = steps[stepIdx];
  if (!step) {
    // safety: se papel não tem steps definidos, marca como done
    markDone(userId, role);
    return null;
  }

  const isLast = stepIdx === steps.length - 1;
  const isFirst = stepIdx === 0;

  function close(persist = true) {
    if (persist && userId && role) markDone(userId, role);
    setVisible(false);
  }

  function next() {
    if (isLast) {
      close(true);
      return;
    }
    const upcoming = steps[stepIdx + 1];
    setStepIdx(stepIdx + 1);
    if (upcoming?.route) {
      navigate(upcoming.route);
    }
  }

  function prev() {
    if (isFirst) return;
    setStepIdx(stepIdx - 1);
  }

  function goToStepRoute() {
    if (step.route) navigate(step.route);
  }

  return (
    <div
      data-testid="onboarding-tour"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
      onClick={(e) => {
        // Click no backdrop = pular (com confirm leve via prompt seria pesado)
        if (e.target === e.currentTarget) {
          /* não fecha — usuário deve usar Pular explicitamente */
        }
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          maxWidth: 480,
          width: '100%',
          padding: '1.5rem',
          boxShadow: '0 20px 60px rgba(15, 23, 42, 0.35)',
        }}
      >
        {/* Progress bar */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            marginBottom: '1rem',
          }}
        >
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: i <= stepIdx ? colors.primary : colors.border,
                transition: 'background 0.2s',
              }}
            />
          ))}
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '0.5rem' }}>
          {step.icon && (
            <div style={{ fontSize: 32, lineHeight: 1 }} aria-hidden>
              {step.icon}
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: colors.muted, fontWeight: 600 }}>
              Passo {stepIdx + 1} de {steps.length}
            </div>
            <h2
              id="onboarding-title"
              style={{ margin: 0, fontSize: 18, color: colors.text }}
            >
              {step.title}
            </h2>
          </div>
        </div>

        {/* Body */}
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: colors.text,
            margin: '0.75rem 0 1.25rem',
          }}
        >
          {step.body}
        </p>

        {step.route && (
          <button
            type="button"
            onClick={goToStepRoute}
            style={{
              ...btnSecondary,
              marginBottom: '1rem',
              fontSize: 12,
            }}
          >
            Ir para {step.route} →
          </button>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => close(true)}
            data-testid="onboarding-skip"
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.muted,
              fontSize: 13,
              cursor: 'pointer',
              padding: '0.5rem',
            }}
          >
            Pular tour
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {!isFirst && (
              <button type="button" onClick={prev} style={btnSecondary}>
                Anterior
              </button>
            )}
            <button
              type="button"
              onClick={next}
              data-testid="onboarding-next"
              style={btn}
            >
              {isLast ? 'Concluir' : 'Próximo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
