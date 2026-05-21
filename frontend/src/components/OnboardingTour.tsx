import { useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserRole } from '@/types/auth';
import { getSession, subscribe } from '@/lib/auth-store';

// Brandbook
const BRAND = {
  navy: '#201554',
  cyan: '#2bcae5',
  magenta: '#bd1fbf',
  bgDark: '#221551',
} as const;

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
    icon: '📊',
    title: 'Relatórios',
    body: 'Em /relatorios você acompanha vendas, funil, comissões, SAC, amostras e campanhas — tudo com variação % vs período anterior.',
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
  const nextBtnRef = useRef<HTMLButtonElement>(null);

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

  // Focus no botão Próximo ao entrar/avançar passo (focus trap leve)
  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => nextBtnRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [visible, stepIdx]);

  // Keyboard: ESC = pular, ← anterior, → próximo
  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current?.();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextRef.current?.();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevRef.current?.();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  // Lock body scroll quando aberto
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [visible]);

  // Refs pra handlers usados via keyboard (evita closure stale)
  const closeRef = useRef<() => void>();
  const nextRef = useRef<() => void>();
  const prevRef = useRef<() => void>();

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
  closeRef.current = () => close(true);

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
  nextRef.current = next;

  function prev() {
    if (isFirst) return;
    setStepIdx(stepIdx - 1);
  }
  prevRef.current = prev;

  function goToStepRoute() {
    if (step.route) navigate(step.route);
  }

  return (
    <div
      data-testid="onboarding-tour"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-body"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(16, 24, 32, 0.7)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        backdropFilter: 'blur(4px)',
        animation: 'tour-fade-in 200ms ease-out',
      }}
    >
      {/* Animação keyframes */}
      <style>
        {`
          @keyframes tour-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes tour-slide-up {
            from { transform: translateY(12px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}
      </style>
      <div
        key={stepIdx /* re-render anima cada step */}
        style={{
          background: BRAND.bgDark,
          color: '#F8F7F2',
          borderRadius: 10,
          maxWidth: 480,
          width: '100%',
          padding: '1.5rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          fontFamily: 'var(--font-ui, Cabin, system-ui, sans-serif)',
          animation: 'tour-slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          border: `1px solid ${BRAND.cyan}33`,
        }}
        // aria-live anuncia mudança de step pra screen readers
        aria-live="polite"
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
                background: i <= stepIdx ? BRAND.magenta : 'rgba(248,247,242,0.15)',
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
            <div
              style={{
                fontSize: 11,
                color: BRAND.cyan,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Passo {stepIdx + 1} de {steps.length}
            </div>
            <h2
              id="onboarding-title"
              style={{
                margin: 0,
                fontSize: 20,
                color: '#F8F7F2',
                fontFamily: 'var(--font-display, "Fira Sans", system-ui)',
                fontWeight: 800,
              }}
            >
              {step.title}
            </h2>
          </div>
        </div>

        {/* Body */}
        <p
          id="onboarding-body"
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: 'rgba(248,247,242,0.85)',
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
              background: `${BRAND.cyan}22`,
              color: BRAND.cyan,
              border: `1px solid ${BRAND.cyan}55`,
              borderRadius: 10,
              padding: '0.5rem 0.875rem',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              marginBottom: '1rem',
              transition: 'background 120ms',
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
              color: 'rgba(248,247,242,0.5)',
              fontSize: 13,
              cursor: 'pointer',
              padding: '0.5rem',
              textDecoration: 'underline',
            }}
            aria-label="Pular tour de onboarding"
          >
            Pular tour
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {!isFirst && (
              <button
                type="button"
                onClick={prev}
                style={{
                  background: 'transparent',
                  color: 'rgba(248,247,242,0.85)',
                  border: '1px solid rgba(248,247,242,0.25)',
                  borderRadius: 10,
                  padding: '0.5rem 1rem',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                aria-label="Passo anterior (atalho: seta esquerda)"
              >
                ← Anterior
              </button>
            )}
            <button
              ref={nextBtnRef}
              type="button"
              onClick={next}
              data-testid="onboarding-next"
              style={{
                background: BRAND.magenta,
                color: '#F8F7F2',
                border: 'none',
                borderRadius: 10,
                padding: '0.5rem 1.25rem',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: `0 4px 12px ${BRAND.magenta}55`,
              }}
              aria-label={isLast ? 'Concluir tour' : 'Próximo passo (atalho: seta direita)'}
            >
              {isLast ? 'Concluir 🎉' : 'Próximo →'}
            </button>
          </div>
        </div>

        {/* Hint de atalhos */}
        <div
          style={{
            marginTop: '0.75rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid rgba(248,247,242,0.1)',
            fontSize: 11,
            color: 'rgba(248,247,242,0.4)',
            textAlign: 'center',
          }}
        >
          Atalhos: <kbd>←</kbd> anterior · <kbd>→</kbd> próximo · <kbd>Esc</kbd> pular
        </div>
      </div>
    </div>
  );
}
