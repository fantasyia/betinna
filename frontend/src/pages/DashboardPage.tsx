import { useState } from 'react';
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
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole, usePermission } from '@/hooks/usePermission';
import { PrimeirosPassosRep } from '@/components/PrimeirosPassosRep';
import {
  useDashboardPrefs,
  DASHBOARD_MODULOS,
  type DashboardModulo,
} from '@/hooks/useDashboardPrefs';
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
  Checkbox,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  formatMoeda as fmtBRL,
  formatMoedaCompacta as fmtBRLCompact,
  formatNumero,
  formatPercent,
} from '@/lib/masks';

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

/**
 * Etapa do funil no dashboard. `label`/`cor` só vêm quando um funil customizado
 * é selecionado (snapshot por FunilEtapa). No padrão, usa o enum LeadEtapa e o
 * label/cor saem do mapa local.
 */
interface FunilStage {
  etapa: string;
  label?: string;
  cor?: string;
  count: number;
  valorEstimado: number;
}

/** Item do seletor de funil (vem de GET /funis). */
interface FunilOpt {
  id: string;
  nome: string;
  /** Total de leads no funil — usado pra escolher o default (o mais movimentado). */
  _count?: { leads: number };
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
  const { prefs, toggle } = useDashboardPrefs();

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
          <div className="flex items-center gap-2">
            <PersonalizarMenu prefs={prefs} onToggle={toggle} />
            <Link to="/relatorios">
              <Button rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                Ver relatórios completos
              </Button>
            </Link>
          </div>
        ) : undefined
      }
    >
      <PrimeirosPassosRep />
      {canSeeRelatorios ? (
        <StateView loading={loading} error={error} onRetry={refetch}>
          {data &&
            (() => {
              const vendas = data.vendas ?? ({} as DashboardResp['vendas']);
              const funil = data.funil ?? ({} as DashboardResp['funil']);
              const sac = data.sac ?? ({} as DashboardResp['sac']);
              const faturamento = vendas.faturamento ?? { atual: 0, anterior: 0, variacao: 0 };
              const porRep = vendas.porRep ?? [];
              const totalPedidos = vendas.totalPedidos ?? 0;
              const ticketMedio = vendas.ticketMedio ?? 0;
              const totalAtivos = funil.totalAtivos ?? 0;
              const taxaConversao = funil.taxaConversao ?? 0;
              const slaEstourado = sac.slaEstourado ?? 0;

              const isEmpty = totalPedidos === 0 && totalAtivos === 0 && (sac.abertas ?? 0) === 0;

              return (
                <div className="flex flex-col gap-5">
                  {/* F7 — aviso quando tudo está oculto */}
                  {!prefs.kpis && !prefs.topReps && !prefs.funil && !prefs.atalhos && (
                    <Card padding="md">
                      <EmptyState
                        size="sm"
                        icon={<SlidersHorizontal />}
                        title="Dashboard vazio"
                        description='Use "Personalizar" no topo pra escolher o que aparece aqui.'
                      />
                    </Card>
                  )}

                  {/* KPI grid */}
                  {prefs.kpis && (
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
                      value={formatNumero(totalPedidos)}
                      hint="no período"
                    />
                    <Stat
                      label="Ticket médio"
                      icon={<Receipt />}
                      iconTone="magenta"
                      value={totalPedidos > 0 ? fmtBRL(ticketMedio) : '—'}
                      hint={totalPedidos > 0 ? undefined : 'sem pedidos no período'}
                    />
                    <Stat
                      label="Leads ativos"
                      icon={<Target />}
                      iconTone="blue"
                      value={formatNumero(totalAtivos)}
                      hint="no funil"
                    />
                    <Stat
                      label="Conversão"
                      icon={<TrendingUp />}
                      iconTone="success"
                      value={formatPercent(taxaConversao, 0)}
                      trend={taxaConversao > 25 ? 'up' : taxaConversao > 10 ? 'flat' : 'down'}
                    />
                    <Stat
                      label="SLA estourado"
                      icon={<AlertTriangle />}
                      iconTone={slaEstourado > 0 ? 'danger' : 'success'}
                      value={formatNumero(slaEstourado)}
                      hint={slaEstourado > 0 ? 'requer atenção' : 'tudo no prazo'}
                      trend={slaEstourado > 0 ? 'down' : 'up'}
                    />
                  </section>
                  )}

                  {/* Top reps + Funil */}
                  {(prefs.topReps || prefs.funil) && (
                  <section
                    className={cn(
                      'grid grid-cols-1 gap-4',
                      prefs.topReps && prefs.funil ? 'lg:grid-cols-2' : 'lg:grid-cols-1',
                    )}
                  >
                    {/* Top reps */}
                    {prefs.topReps && (
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
                    )}

                    {/* Funil — com seletor de funil customizado */}
                    {prefs.funil && <FunilCard />}
                  </section>
                  )}

                  {/* Quick actions */}
                  {prefs.atalhos && (
                  <Card padding="md">
                    <CardHeader>
                      <CardTitle>Atalhos rápidos</CardTitle>
                    </CardHeader>
                    <div className="flex flex-wrap gap-2">
                      <QuickAction to="/clientes" label="Clientes" icon={Briefcase} tone="primary" />
                      <QuickAction to="/pedidos" label="Pedidos" icon={ShoppingCart} tone="secondary" />
                      <QuickAction to="/leads" label="Funil" icon={Target} tone="blue" />
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
                  )}

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

/** F7 — menu pra ligar/desligar seções do dashboard (persistido por usuário). */
function PersonalizarMenu({
  prefs,
  onToggle,
}: {
  prefs: Record<DashboardModulo, boolean>;
  onToggle: (k: DashboardModulo) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
        data-testid="dashboard-personalizar"
      >
        Personalizar
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            className={cn(
              'absolute right-0 top-full mt-1 z-40 min-w-[230px]',
              'bg-surface-elevated border border-border-strong rounded-md shadow-lg p-2',
              'flex flex-col gap-0.5 animate-fade-in',
            )}
          >
            <div className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Mostrar no dashboard
            </div>
            {DASHBOARD_MODULOS.map((m) => (
              <label
                key={m.key}
                className="flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-surface-hover cursor-pointer"
              >
                <Checkbox
                  checked={prefs[m.key]}
                  onChange={() => onToggle(m.key)}
                  data-testid={`dashboard-toggle-${m.key}`}
                />
                <span className="text-sm text-text">{m.label}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

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

/**
 * Card "Funil de leads" com SELETOR de funil. Lista os funis da empresa e mostra
 * a distribuição por etapa do funil escolhido (de `/relatorios/funil?funilId=…`),
 * abrindo no funil PADRÃO da empresa — o `isPadrao`, que `/funis` ordena primeiro.
 */
function FunilCard() {
  const canSeeFunis = usePermission('funis.view');
  const [funilId, setFunilId] = useState('');

  // Lista de funis pro seletor — só pra quem pode ver kanban.
  const { data: funisData } = useApiQuery<FunilOpt[]>(canSeeFunis ? '/funis' : null);
  const funis = funisData ?? [];

  // Default = o funil com MAIS leads (o mais movimentado); empata pela ordem de
  // /funis (isPadrao primeiro). Evita abrir num funil vazio quando outro tem leads.
  const funilDefault =
    funis.length > 0
      ? [...funis].sort((a, b) => (b._count?.leads ?? 0) - (a._count?.leads ?? 0))[0]
      : undefined;
  const effectiveFunilId = funilId || funilDefault?.id || '';

  const { data: funilData, loading: funilLoading } = useApiQuery<{ funilAtual: FunilStage[] }>(
    effectiveFunilId ? `/relatorios/funil?periodo=mes&funilId=${effectiveFunilId}` : null,
  );

  const stages = funilData?.funilAtual ?? [];
  const isEmpty = stages.length === 0 || stages.every((e) => e.count === 0);

  return (
    <Card padding="md">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Funil de leads</CardTitle>
            <CardDescription>Distribuição por etapa</CardDescription>
          </div>
          {funis.length > 0 && (
            <select
              data-testid="dashboard-funil-select"
              value={effectiveFunilId}
              onChange={(e) => setFunilId(e.target.value)}
              aria-label="Selecionar funil"
              className={cn(
                'h-8 max-w-[180px] shrink-0 rounded-md border border-border bg-surface px-2',
                'text-sm text-text cursor-pointer',
                'hover:border-border-strong focus:outline-none focus:border-primary',
              )}
            >
              {funis.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          )}
        </div>
      </CardHeader>
      {effectiveFunilId && funilLoading ? (
        <div className="py-8 text-center text-sm text-muted">Carregando funil…</div>
      ) : !effectiveFunilId ? (
        <EmptyState
          size="sm"
          icon={<Target />}
          title="Nenhum funil configurado"
          description="Crie um funil pra acompanhar seus leads por etapa."
          action={
            <Link to="/funis">
              <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="h-3 w-3" />}>
                Configurar funis
              </Button>
            </Link>
          }
        />
      ) : isEmpty ? (
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
        <FunnelView stages={stages} />
      )}
    </Card>
  );
}

function FunnelView({ stages }: { stages: FunilStage[] }) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <ul className="flex flex-col gap-1.5">
      {stages.map((s) => {
        const pct = (s.count / max) * 100;
        const label = s.label ?? ETAPA_LABEL[s.etapa] ?? s.etapa;
        const variant = ETAPA_BADGE[s.etapa] ?? 'neutral';
        return (
          <li key={s.etapa} className="flex items-center gap-3 py-1">
            {s.cor ? (
              // Funil customizado: chip sólido com a cor da etapa.
              <span
                className="min-w-[88px] inline-flex items-center justify-center truncate rounded-md px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: s.cor }}
                title={label}
              >
                {label}
              </span>
            ) : (
              <Badge variant={variant} className="min-w-[88px] justify-center">
                {label}
              </Badge>
            )}
            <div className="flex-1 relative h-7 rounded-md bg-surface-hover overflow-hidden">
              <div
                className={cn(
                  'absolute inset-y-0 left-0 transition-all duration-300',
                  s.cor && 'opacity-30',
                  !s.cor && variant === 'success' && 'bg-success/30',
                  !s.cor && variant === 'danger' && 'bg-danger/30',
                  !s.cor && variant === 'warning' && 'bg-warning/30',
                  !s.cor && variant === 'info' && 'bg-info/30',
                  !s.cor && variant === 'primary' && 'bg-primary/30',
                  !s.cor && variant === 'neutral' && 'bg-muted/30',
                )}
                style={s.cor ? { width: `${pct}%`, backgroundColor: s.cor } : { width: `${pct}%` }}
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
    { to: '/usuarios', label: 'Convidar usuários', hint: 'Adicionar representantes e gerentes', icon: Users },
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
