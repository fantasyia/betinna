import { Link } from 'react-router-dom';
import {
  DollarSign,
  ShoppingCart,
  Receipt,
  Target,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Plug,
  Users,
  Package,
  Briefcase,
  CalendarDays,
  Wallet,
  Megaphone,
  MessageSquare,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole, usePermission } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  Stat,
  EmptyState,
  Badge,
  Avatar,
} from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * DashboardPage v2 — design system dark, KPIs em grid, top reps + funil, atalhos
 * com ícones lucide. Mantém o backend contract idêntico (mesmo endpoint).
 */

interface DashboardResp {
  vendas: {
    faturamento: { atual: number; anterior: number; variacao: number };
    totalPedidos: number;
    ticketMedio: number;
    porRep: Array<{ repId: string; repNome: string; pedidos: number; total: number }>;
  };
  funil: {
    funilAtual: Array<{ etapa: string; count: number; valorEstimado: number }>;
    totalAtivos: number;
    taxaConversao: number;
  };
  sac: {
    abertas: number;
    slaEstourado: number;
  };
  amostras: {
    enviadas: number;
    convertidas: number;
    taxaConversao: number;
  };
}

const ETAPA_LABEL: Record<string, string> = {
  NOVO: 'Novo',
  QUALIFICANDO: 'Qualificando',
  PROPOSTA: 'Proposta',
  NEGOCIACAO: 'Negociação',
  GANHO: 'Ganho',
  PERDIDO: 'Perdido',
};

// Mapeamento etapa → variant da Badge (mantém coerência com tokens)
const ETAPA_BADGE: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'neutral' | 'primary'> = {
  NOVO: 'info',
  QUALIFICANDO: 'primary',
  PROPOSTA: 'warning',
  NEGOCIACAO: 'warning',
  GANHO: 'success',
  PERDIDO: 'danger',
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtBRLCompact(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return fmtBRL(v);
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  DIRECTOR: 'Diretor',
  GERENTE: 'Gerente',
  SAC: 'SAC',
  REP: 'Representante',
};

export default function DashboardPage() {
  const role = useRole();
  const canSeeRelatorios = usePermission('relatorios.view');
  const canSeeCampanhas = usePermission('campanhas.view');

  const { data, loading, error, refetch } = useApiQuery<DashboardResp>(
    canSeeRelatorios ? '/relatorios/dashboard?periodo=mes' : null,
  );

  return (
    <PageLayout
      title="Dashboard"
      description={
        role ? (
          <>
            Bem-vindo de volta. Você está logado como{' '}
            <strong className="text-text">{ROLE_LABEL[role] ?? role}</strong>.
          </>
        ) : (
          'Visão consolidada do seu negócio.'
        )
      }
      actions={
        canSeeRelatorios ? (
          <Link to="/relatorios">
            <Button rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
              Ver relatórios completos
            </Button>
          </Link>
        ) : undefined
      }
    >
      {canSeeRelatorios ? (
        <StateView loading={loading} error={error} onRetry={refetch}>
          {data &&
            (() => {
              const vendas = data.vendas ?? ({} as DashboardResp['vendas']);
              const funil = data.funil ?? ({} as DashboardResp['funil']);
              const sac = data.sac ?? ({} as DashboardResp['sac']);
              const faturamento = vendas.faturamento ?? { atual: 0, anterior: 0, variacao: 0 };
              const porRep = vendas.porRep ?? [];
              const funilAtual = funil.funilAtual ?? [];
              const totalPedidos = vendas.totalPedidos ?? 0;
              const ticketMedio = vendas.ticketMedio ?? 0;
              const totalAtivos = funil.totalAtivos ?? 0;
              const taxaConversao = funil.taxaConversao ?? 0;
              const slaEstourado = sac.slaEstourado ?? 0;

              const isEmpty = totalPedidos === 0 && totalAtivos === 0 && (sac.abertas ?? 0) === 0;

              return (
                <div className="flex flex-col gap-5">
                  {/* KPI grid */}
                  <section
                    className={cn(
                      'grid gap-3',
                      'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
                    )}
                  >
                    <Stat
                      label="Faturamento"
                      icon={<DollarSign />}
                      iconTone="primary"
                      value={fmtBRLCompact(faturamento.atual)}
                      hint={faturamento.anterior > 0 ? `Anterior: ${fmtBRLCompact(faturamento.anterior)}` : 'no mês'}
                      delta={faturamento.variacao || undefined}
                      sparkColor="var(--primary)"
                    />
                    <Stat
                      label="Pedidos"
                      icon={<ShoppingCart />}
                      iconTone="secondary"
                      value={totalPedidos.toLocaleString('pt-BR')}
                      hint="no período"
                    />
                    <Stat
                      label="Ticket médio"
                      icon={<Receipt />}
                      iconTone="magenta"
                      value={fmtBRL(ticketMedio)}
                    />
                    <Stat
                      label="Leads ativos"
                      icon={<Target />}
                      iconTone="blue"
                      value={totalAtivos.toLocaleString('pt-BR')}
                      hint="no funil"
                    />
                    <Stat
                      label="Conversão"
                      icon={<TrendingUp />}
                      iconTone="success"
                      value={`${taxaConversao.toFixed(0)}%`}
                      trend={taxaConversao > 25 ? 'up' : taxaConversao > 10 ? 'flat' : 'down'}
                    />
                    <Stat
                      label="SLA estourado"
                      icon={<AlertTriangle />}
                      iconTone={slaEstourado > 0 ? 'danger' : 'success'}
                      value={slaEstourado.toLocaleString('pt-BR')}
                      hint={slaEstourado > 0 ? 'requer atenção' : 'tudo no prazo'}
                      trend={slaEstourado > 0 ? 'down' : 'up'}
                    />
                  </section>

                  {/* Top reps + Funil */}
                  <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Top reps */}
                    <Card padding="md">
                      <CardHeader>
                        <CardTitle>Top representantes</CardTitle>
                        <CardDescription>Maior faturamento no período</CardDescription>
                      </CardHeader>
                      {porRep.length === 0 ? (
                        <EmptyState
                          size="sm"
                          icon={<Users />}
                          title="Sem vendas no período"
                          description="Quando houver pedidos, o ranking aparece aqui."
                          action={
                            <Link to="/pedidos">
                              <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="h-3 w-3" />}>
                                Criar pedido
                              </Button>
                            </Link>
                          }
                        />
                      ) : (
                        <TopRepsList reps={porRep.slice(0, 5)} />
                      )}
                    </Card>

                    {/* Funil */}
                    <Card padding="md">
                      <CardHeader>
                        <CardTitle>Funil de leads</CardTitle>
                        <CardDescription>Distribuição por etapa</CardDescription>
                      </CardHeader>
                      {funilAtual.length === 0 || funilAtual.every((e) => e.count === 0) ? (
                        <EmptyState
                          size="sm"
                          icon={<Target />}
                          title="Sem leads ainda"
                          description="Cadastre o primeiro lead pra ver o funil."
                          action={
                            <Link to="/leads">
                              <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="h-3 w-3" />}>
                                Captar lead
                              </Button>
                            </Link>
                          }
                        />
                      ) : (
                        <FunnelView stages={funilAtual} />
                      )}
                    </Card>
                  </section>

                  {/* Quick actions */}
                  <Card padding="md">
                    <CardHeader>
                      <CardTitle>Atalhos rápidos</CardTitle>
                    </CardHeader>
                    <div className="flex flex-wrap gap-2">
                      <QuickAction to="/clientes" label="Clientes" icon={Briefcase} tone="primary" />
                      <QuickAction to="/pedidos" label="Pedidos" icon={ShoppingCart} tone="secondary" />
                      <QuickAction to="/leads" label="Pipeline" icon={Target} tone="blue" />
                      <QuickAction to="/inbox" label="Inbox" icon={MessageSquare} tone="magenta" />
                      <QuickAction to="/agenda" label="Agenda" icon={CalendarDays} tone="primary" />
                      <QuickAction to="/comissoes" label="Comissões" icon={Wallet} tone="success" />
                      <QuickAction to="/catalogo" label="Catálogo" icon={Sparkles} tone="secondary" />
                      {canSeeCampanhas && (
                        <QuickAction to="/campanhas" label="Campanhas" icon={Megaphone} tone="magenta" />
                      )}
                      <QuickAction to="/integracoes" label="Integrações" icon={Plug} tone="blue" />
                    </div>
                  </Card>

                  {/* Onboarding card (só aparece se totalmente zerado) */}
                  {isEmpty && <FirstStepsCard />}
                </div>
              );
            })()}
        </StateView>
      ) : (
        <EmptyState
          icon={<AlertTriangle />}
          title="Sem permissão pra ver dashboard"
          description="Pede pro seu admin habilitar relatorios.view no seu perfil."
        />
      )}
    </PageLayout>
  );
}

// ─── Componentes locais ──────────────────────────────────────────────

function TopRepsList({
  reps,
}: {
  reps: Array<{ repId: string; repNome: string; pedidos: number; total: number }>;
}) {
  const max = Math.max(...reps.map((r) => r.total), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {reps.map((r, idx) => {
        const pct = (r.total / max) * 100;
        return (
          <li key={r.repId} className="flex items-center gap-3">
            <span className="text-xs font-mono tabular text-muted-light w-4">{idx + 1}</span>
            <Avatar name={r.repNome} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-text truncate">{r.repNome}</span>
                <span className="text-sm tabular font-semibold text-text shrink-0">
                  {fmtBRLCompact(r.total)}
                </span>
              </div>
              <div className="mt-1 relative h-1 rounded-full bg-surface-hover overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-muted">
                {r.pedidos} {r.pedidos === 1 ? 'pedido' : 'pedidos'}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function FunnelView({
  stages,
}: {
  stages: Array<{ etapa: string; count: number; valorEstimado: number }>;
}) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <ul className="flex flex-col gap-1.5">
      {stages.map((s) => {
        const pct = (s.count / max) * 100;
        const variant = ETAPA_BADGE[s.etapa] ?? 'neutral';
        return (
          <li key={s.etapa} className="flex items-center gap-3 py-1">
            <Badge variant={variant} className="min-w-[88px] justify-center">
              {ETAPA_LABEL[s.etapa] ?? s.etapa}
            </Badge>
            <div className="flex-1 relative h-7 rounded-md bg-surface-hover overflow-hidden">
              <div
                className={cn(
                  'absolute inset-y-0 left-0 transition-all duration-300',
                  variant === 'success' && 'bg-success/30',
                  variant === 'danger' && 'bg-danger/30',
                  variant === 'warning' && 'bg-warning/30',
                  variant === 'info' && 'bg-info/30',
                  variant === 'primary' && 'bg-primary/30',
                  variant === 'neutral' && 'bg-muted/30',
                )}
                style={{ width: `${pct}%` }}
              />
              <span className="absolute inset-y-0 left-3 right-3 flex items-center justify-between text-xs">
                <span className="font-medium text-text">{s.count}</span>
                {s.valorEstimado > 0 && (
                  <span className="tabular text-muted">{fmtBRLCompact(s.valorEstimado)}</span>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type QuickTone = 'primary' | 'secondary' | 'magenta' | 'blue' | 'success';

const QA_TONE: Record<QuickTone, string> = {
  primary:
    'bg-primary/10 border-primary/30 text-primary hover:bg-primary/20 hover:border-primary',
  secondary:
    'bg-secondary/15 border-secondary/40 text-secondary-hover hover:bg-secondary/25 hover:border-secondary',
  magenta:
    'bg-magenta/10 border-magenta/30 text-magenta hover:bg-magenta/20 hover:border-magenta',
  blue: 'bg-blue/10 border-blue/30 text-blue hover:bg-blue/20 hover:border-blue',
  success:
    'bg-success/10 border-success/30 text-success hover:bg-success/20 hover:border-success',
};

function QuickAction({
  to,
  label,
  icon: Icon,
  tone = 'primary',
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  tone?: QuickTone;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium',
        'border transition-all duration-100',
        'hover:-translate-y-0.5 hover:shadow-sm',
        QA_TONE[tone],
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}

function FirstStepsCard() {
  const steps: Array<{ to: string; label: string; hint: string; icon: LucideIcon }> = [
    { to: '/integracoes', label: 'Conectar OMIE', hint: 'Sync de clientes + produtos', icon: Plug },
    { to: '/usuarios', label: 'Convidar usuários', hint: 'Adicionar reps e gerentes', icon: Users },
    { to: '/clientes', label: 'Cadastrar clientes', hint: 'Manual ou via OMIE', icon: Briefcase },
    { to: '/produtos', label: 'Catálogo de produtos', hint: 'Manual ou via OMIE', icon: Package },
    { to: '/pedidos', label: 'Criar primeiro pedido', hint: 'Começar a operar', icon: ShoppingCart },
  ];

  return (
    <Card
      variant="default"
      padding="md"
      className="bg-gradient-to-br from-primary/5 via-secondary/5 to-magenta/5 border-primary/30"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-brand text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          Primeiros passos
        </CardTitle>
        <CardDescription>Você está em uma instância nova. Comece por aqui:</CardDescription>
      </CardHeader>
      <ol className="flex flex-col gap-1.5">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.to}>
              <Link
                to={step.to}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-md',
                  'bg-surface border border-border hover:border-primary/40 hover:bg-primary/5',
                  'transition-all hover:-translate-y-0.5 hover:shadow-sm group',
                )}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface border border-border text-xs font-bold text-muted tabular shrink-0">
                  {i + 1}
                </span>
                <Icon className="h-4 w-4 text-text-subtle shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text">{step.label}</div>
                  <div className="text-xs text-muted">{step.hint}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </Link>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
