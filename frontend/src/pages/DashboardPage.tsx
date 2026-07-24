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
  RESIZABLE_MODULOS,
  WIDTH_OPCOES,
  type DashboardModulo,
  type ModuloWidth,
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
import { SkeletonCard, SkeletonLine } from '@/components/ui';
import { PulseBar } from './dashboard/PulseBar';
import { PrecisaDeVoce } from './dashboard/PrecisaDeVoce';
import { FluxosSala } from './dashboard/FluxosSala';
import { ProntidaoCard } from './dashboard/ProntidaoCard';
import { TrilhoAcao } from './dashboard/TrilhoAcao';
import type { DashboardResumo } from './dashboard/types';
import { AgendaHoje } from './dashboard/AgendaHoje';
import { MensagensInternas } from './dashboard/MensagensInternas';
import { FunilEtapaDrawer } from './dashboard/FunilEtapaDrawer';
import { CalendarioResumo } from './dashboard/CalendarioResumo';
import { RelatoriosGraficos } from './dashboard/RelatoriosGraficos';

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
  probabilidade?: number;
  valorPonderado?: number;
  entradasPeriodo?: number;
  tempoMedioDias?: number | null;
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

/**
 * Largura do módulo → classe de col-span no grid de 12 colunas do canvas.
 * Literais (não `col-span-${w}`) pra o Tailwind JIT enxergar as classes.
 */
const SPAN: Record<ModuloWidth, string> = {
  4: 'min-[1024px]:col-span-4',
  6: 'min-[1024px]:col-span-6',
  8: 'min-[1024px]:col-span-8',
  12: 'min-[1024px]:col-span-12',
};

export default function DashboardPage() {
  const role = useRole();
  const canSeeRelatorios = usePermission('relatorios.view');
  const canSeeCampanhas = usePermission('campanhas.view');
  const { prefs, toggle, setWidth, widthOf } = useDashboardPrefs();

  // Cockpit: UMA chamada de agregação (pulso + triagem + prontidão + sala de
  // fluxos). O módulo de VENDAS carrega em paralelo, independente — módulo
  // lento não trava a tela (cada um tem skeleton próprio).
  const {
    data: resumo,
    loading: resumoLoading,
    refetch: refetchResumo,
  } = useApiQuery<DashboardResumo>(canSeeRelatorios ? '/dashboard/resumo' : null);
  const { data, loading, error, refetch } = useApiQuery<DashboardResp>(
    canSeeRelatorios ? '/relatorios/dashboard?periodo=mes' : null,
  );

  const ehGestao = role !== 'REP';

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
            <PersonalizarMenu
              prefs={prefs}
              onToggle={toggle}
              widthOf={widthOf}
              onSetWidth={setWidth}
            />
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
      {!canSeeRelatorios ? (
        <EmptyState
          icon={<AlertTriangle />}
          title="Sem permissão pra ver dashboard"
          description="Pede pro seu admin habilitar relatorios.view no seu perfil."
        />
      ) : (
        <>
          {/* M1 — barra de pulso (sticky). Skeleton independente. */}
          {prefs.pulso &&
            (resumo ? (
              <PulseBar pulso={resumo.pulso} />
            ) : resumoLoading ? (
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 min-[1280px]:grid-cols-6 py-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-[10px] border border-border bg-surface px-3.5 py-3">
                    <SkeletonLine width="60%" />
                    <div className="mt-2">
                      <SkeletonLine width="40%" />
                    </div>
                  </div>
                ))}
              </div>
            ) : null)}

          {/* Canvas + trilho fixo. O trilho vem ANTES no DOM: abaixo de 1024px
              ele empilha no TOPO da página (regra do card). */}
          <div className="mt-3 grid grid-cols-1 gap-4 min-[1024px]:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-[1024px]:order-2 min-w-0">
              <TrilhoAcao badge={resumo?.triagem.length ?? 0}>
                {prefs.precisa &&
                  (resumo ? <PrecisaDeVoce itens={resumo.triagem} /> : <SkeletonCard />)}
                {prefs.agenda &&
                  (resumo ? <AgendaHoje itens={resumo.agendaHoje ?? []} /> : <SkeletonCard />)}
                {prefs.mensagens &&
                  ehGestao &&
                  (resumo ? (
                    <MensagensInternas mensagens={resumo.mensagens ?? []} />
                  ) : (
                    <SkeletonCard />
                  ))}
              </TrilhoAcao>
            </div>

            {/* Canvas = grid de 12 colunas com dense-flow: cada módulo tem
                largura própria (Personalizar) e o empacotamento preenche os
                vãos. items-stretch deixa cards da mesma fileira com altura
                igual (sem buraco entre eles). */}
            <div className="min-[1024px]:order-1 min-w-0 grid grid-cols-1 gap-3 min-[1024px]:grid-cols-12 min-[1024px]:grid-flow-row-dense">
              {/* MODO PRONTIDÃO — sempre cheio, só quando a máquina está desligada. */}
              {ehGestao && resumo?.prontidao.ativo && resumo.prontidao.linhas.length > 0 && (
                <div className="min-w-0 min-[1024px]:col-span-12">
                  <ProntidaoCard linhas={resumo.prontidao.linhas} />
                </div>
              )}

              {/* M6 — sala de controle (gestão; pro REP o backend devolve vazio). */}
              {prefs.fluxosSala && ehGestao && (resumo || resumoLoading) && (
                <div className={cn('min-w-0 [&>*]:h-full', SPAN[widthOf('fluxosSala')])}>
                  {resumo ? (
                    <FluxosSala fluxos={resumo.fluxosSala} onChanged={refetchResumo} />
                  ) : (
                    <SkeletonCard />
                  )}
                </div>
              )}

              {/* M7 — resumo do calendário de marketing (gestão). */}
              {prefs.calendario && ehGestao && (
                <div className={cn('min-w-0 [&>*]:h-full', SPAN[widthOf('calendario')])}>
                  <CalendarioResumo />
                </div>
              )}

              {/* M8 — gráficos de relatórios (endpoint único /dashboard/graficos). */}
              {prefs.graficos && canSeeRelatorios && (
                <div className={cn('min-w-0 [&>*]:h-full', SPAN[widthOf('graficos')])}>
                  <RelatoriosGraficos ehGestao={ehGestao} />
                </div>
              )}

              {/* Vendas: cada card é uma célula PRÓPRIA do grid — o dense-flow
                  empacota e o usuário escolhe a largura de cada um. */}
              {error && !data && (
                <div className="min-w-0 min-[1024px]:col-span-12">
                  <StateView loading={false} error={error} onRetry={refetch}>
                    {null}
                  </StateView>
                </div>
              )}

              {prefs.kpis && (data || loading) && (
                <div id="mod-funil" className={cn('min-w-0 scroll-mt-24', SPAN[widthOf('kpis')])}>
                  {data ? <VendasKpis data={data} /> : <SkeletonCard />}
                </div>
              )}

              {prefs.topReps && (data || loading) && (
                <div className={cn('min-w-0 [&>*]:h-full', SPAN[widthOf('topReps')])}>
                  {data ? <TopRepsCard porRep={data.vendas?.porRep ?? []} /> : <SkeletonCard />}
                </div>
              )}

              {prefs.funil && (
                <div className={cn('min-w-0 [&>*]:h-full', SPAN[widthOf('funil')])}>
                  <FunilCard />
                </div>
              )}

              {prefs.atalhos && (
                <div className={cn('min-w-0 [&>*]:h-full', SPAN[widthOf('atalhos')])}>
                  <AtalhosCard canSeeCampanhas={canSeeCampanhas} />
                </div>
              )}

              {data && dashboardVazio(data) && (
                <div className="min-w-0 min-[1024px]:col-span-12">
                  <FirstStepsCard />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}

// ─── Componentes locais ──────────────────────────────────────────────

/**
 * F7 — menu pra ligar/desligar seções do dashboard E escolher a largura de cada
 * módulo do canvas (⅓/½/⅔/cheio). Tudo persistido por usuário.
 */
function PersonalizarMenu({
  prefs,
  onToggle,
  widthOf,
  onSetWidth,
}: {
  prefs: Record<DashboardModulo, boolean>;
  onToggle: (k: DashboardModulo) => void;
  widthOf: (k: DashboardModulo) => ModuloWidth;
  onSetWidth: (k: DashboardModulo, w: ModuloWidth) => void;
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
              'absolute right-0 top-full mt-1 z-40 w-[300px] max-h-[75vh] overflow-y-auto',
              'bg-surface-elevated border border-border-strong rounded-md shadow-lg p-2',
              'flex flex-col gap-0.5 animate-fade-in',
            )}
          >
            <div className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Módulos e largura
            </div>
            {DASHBOARD_MODULOS.map((m) => {
              const resizable = RESIZABLE_MODULOS.includes(m.key);
              return (
                <div key={m.key} className="px-1.5 py-1 rounded hover:bg-surface-hover">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={prefs[m.key]}
                      onChange={() => onToggle(m.key)}
                      data-testid={`dashboard-toggle-${m.key}`}
                    />
                    <span className="text-sm text-text">{m.label}</span>
                  </label>
                  {resizable && prefs[m.key] && (
                    <div className="mt-1 ml-6 flex items-center gap-1">
                      <span className="text-[10px] text-muted mr-0.5">Largura</span>
                      {WIDTH_OPCOES.map((o) => (
                        <button
                          key={o.w}
                          type="button"
                          title={o.titulo}
                          onClick={() => onSetWidth(m.key, o.w)}
                          data-testid={`dashboard-width-${m.key}-${o.w}`}
                          className={cn(
                            'px-1.5 py-0.5 rounded text-[11px] font-medium border transition-colors',
                            widthOf(m.key) === o.w
                              ? 'bg-primary text-primary-contrast border-primary'
                              : 'bg-surface text-muted border-border-strong hover:text-text',
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <p className="px-1.5 pt-1.5 text-[10px] text-muted leading-snug">
              A largura vale no desktop; no celular tudo empilha. Os módulos se
              reempacotam pra não sobrar buraco.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** Dashboard "vazio" = sem pedidos, sem leads ativos e sem ocorrências abertas. */
function dashboardVazio(data: DashboardResp): boolean {
  return (
    (data.vendas?.totalPedidos ?? 0) === 0 &&
    (data.funil?.totalAtivos ?? 0) === 0 &&
    (data.sac?.abertas ?? 0) === 0
  );
}

/** Indicadores de vendas do mês — 5 tiles densos. Célula própria do canvas. */
function VendasKpis({ data }: { data: DashboardResp }) {
  const vendas = data.vendas ?? ({} as DashboardResp['vendas']);
  const funil = data.funil ?? ({} as DashboardResp['funil']);
  const faturamento = vendas.faturamento ?? { atual: 0, anterior: 0, variacao: 0 };
  const totalPedidos = vendas.totalPedidos ?? 0;
  const ticketMedio = vendas.ticketMedio ?? 0;
  const totalAtivos = funil.totalAtivos ?? 0;
  const taxaConversao = funil.taxaConversao ?? 0;
  return (
    <section className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
      <Stat
        dense
        label="Faturamento"
        icon={<DollarSign />}
        iconTone="primary"
        value={fmtBRLCompact(faturamento.atual)}
        hint={
          faturamento.anterior > 0 ? `Anterior: ${fmtBRLCompact(faturamento.anterior)}` : 'no mês'
        }
        delta={faturamento.variacao || undefined}
        sparkColor="var(--primary)"
      />
      <Stat
        dense
        label="Pedidos"
        icon={<ShoppingCart />}
        iconTone="secondary"
        value={formatNumero(totalPedidos)}
        hint="no período"
      />
      <Stat
        dense
        label="Ticket médio"
        icon={<Receipt />}
        iconTone="magenta"
        value={totalPedidos > 0 ? fmtBRL(ticketMedio) : '—'}
        hint={totalPedidos > 0 ? undefined : 'sem pedidos no período'}
      />
      <Stat
        dense
        label="Leads ativos"
        icon={<Target />}
        iconTone="blue"
        value={formatNumero(totalAtivos)}
        hint="no funil"
      />
      <Stat
        dense
        label="Conversão"
        icon={<TrendingUp />}
        iconTone="success"
        value={formatPercent(taxaConversao, 0)}
        trend={taxaConversao > 25 ? 'up' : taxaConversao > 10 ? 'flat' : 'down'}
      />
    </section>
  );
}

/** Top representantes por faturamento. Preenche a altura da célula (flex). */
function TopRepsCard({
  porRep,
}: {
  porRep: Array<{ repId: string; repNome: string; pedidos: number; total: number }>;
}) {
  return (
    <Card padding="md" className="flex flex-col">
      <CardHeader>
        <CardTitle>Top representantes</CardTitle>
        <CardDescription>Maior faturamento no período</CardDescription>
      </CardHeader>
      {porRep.length === 0 ? (
        <div className="flex-1 grid place-items-center">
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
        </div>
      ) : (
        <TopRepsList reps={porRep.slice(0, 5)} />
      )}
    </Card>
  );
}

/** Atalhos rápidos. */
function AtalhosCard({ canSeeCampanhas }: { canSeeCampanhas: boolean }) {
  return (
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
        <FunnelView stages={stages} funilId={effectiveFunilId} />
      )}
    </Card>
  );
}

function FunnelView({ stages, funilId }: { stages: FunilStage[]; funilId: string }) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  const [etapaAberta, setEtapaAberta] = useState<{ id: string; nome: string } | null>(null);
  // Conversão entre etapas: ENTRADAS no período (histórico), etapa i → i+1.
  const conv = (i: number): number | null => {
    const de = stages[i]?.entradasPeriodo ?? 0;
    const para = stages[i + 1]?.entradasPeriodo ?? 0;
    if (de <= 0) return null;
    return Math.round((para / de) * 100);
  };
  return (
    <>
      <ul className="flex flex-col gap-0">
        {stages.map((s, i) => {
          const pct = (s.count / max) * 100;
          const label = s.label ?? ETAPA_LABEL[s.etapa] ?? s.etapa;
          const variant = ETAPA_BADGE[s.etapa] ?? 'neutral';
          const taxa = conv(i);
          return (
            <li key={s.etapa}>
              <button
                type="button"
                data-testid="funil-etapa"
                onClick={() => setEtapaAberta({ id: s.etapa, nome: label })}
                className="w-full flex items-center gap-3 py-1 rounded-md hover:bg-surface-hover/60 transition-colors text-left"
                aria-label={`Abrir leads de ${label}`}
              >
                {s.cor ? (
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
                    <span className="font-medium text-text">
                      {s.count}
                      {s.tempoMedioDias != null && (
                        <span className="ml-2 text-muted font-normal">média {s.tempoMedioDias}d</span>
                      )}
                    </span>
                    {(s.valorPonderado ?? 0) > 0 ? (
                      <span
                        className="tabular text-muted"
                        title="Valor ponderado pela probabilidade da etapa"
                      >
                        {fmtBRLCompact(s.valorPonderado ?? 0)} pond.
                      </span>
                    ) : s.valorEstimado > 0 ? (
                      <span className="tabular text-muted">{fmtBRLCompact(s.valorEstimado)}</span>
                    ) : null}
                  </span>
                </div>
              </button>
              {/* Conversão entre esta etapa e a PRÓXIMA (entradas do período). */}
              {taxa !== null && i < stages.length - 1 && (
                <div
                  className="pl-[100px] py-0.5 text-[10px] text-muted tabular"
                  data-testid="funil-conversao"
                >
                  ↓ {taxa}% avançam
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {etapaAberta && (
        <FunilEtapaDrawer
          funilId={funilId}
          etapaId={etapaAberta.id}
          etapaNome={etapaAberta.nome}
          onClose={() => setEtapaAberta(null)}
        />
      )}
    </>
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
