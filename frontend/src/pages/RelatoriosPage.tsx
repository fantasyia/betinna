import { useMemo, useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Select } from '@/components/FormField';
import { BarChart, Funnel, Donut, KPICard, type FunnelStage, type DonutSlice } from '@/components/charts';
import { toCsv, downloadCsv, type CsvColumn } from '@/lib/csv';
import { rowsToXlsx } from '@/lib/xlsx';
import { gerarPdf } from '@/lib/pdf';
import { useToast } from '@/components/toast';
import { formatMoeda as fmtBRL, formatMoedaCompacta as fmtBRLCompact } from '@/lib/masks';
import { cn } from '@/lib/cn';

type Periodo = 'mes' | 'trimestre' | 'semestre' | 'ano';
type Tab =
  | 'overview'
  | 'vendas'
  | 'funil'
  | 'comissoes'
  | 'sac'
  | 'amostras'
  | 'campanhas';

// ─── Tipos das responses do backend ──────────────────────────────────

interface VendasResp {
  periodo: { de: string; ate: string };
  faturamento: { atual: number; anterior: number; variacao: number };
  receitaRealizada: number;
  totalPedidos: number;
  ticketMedio: number;
  porStatus: Array<{ status: string; count: number; total: number }>;
  porRep: Array<{ repId: string; repNome: string; pedidos: number; total: number }>;
}

interface FunilResp {
  periodo: { de: string; ate: string };
  funilAtual: Array<{ etapa: string; count: number; valorEstimado: number }>;
  totalAtivos: number;
  criados: { atual: number; anterior: number; variacao: number };
  ganhos: { atual: number; anterior: number; variacao: number };
  perdidos: number;
  taxaConversao: number;
  agingMedioPorEtapa: Record<string, number>;
  porRep: Array<{ repId: string; repNome: string; leads: number; valorEstimado: number }>;
}

interface ComissoesResp {
  periodo: { de: string; ate: string };
  /** Backend usa `pago`/`aPagar`; aliases antigos `totalPago`/`totalAPagar`. */
  pago?: number;
  aPagar?: number;
  totalPago?: number;
  totalAPagar?: number;
  totalComissao?: number;
  totalVendas?: number;
  porTipo?: Array<{ tipo: string; total: number; count: number }>;
  /**
   * Backend devolve a lista em `detalhes` (representanteNome/totalComissao).
   * Versões antigas usavam `porRep` (repNome/valor). Toleramos ambos.
   */
  detalhes?: Array<{
    representanteId?: string;
    representanteNome?: string;
    tipo: 'REP' | 'GERENTE';
    totalComissao?: number;
    valor?: number;
    pago: boolean;
  }>;
  porRep?: Array<{
    repId?: string;
    repNome?: string;
    tipo: 'REP' | 'GERENTE';
    valor?: number;
    totalComissao?: number;
    pago: boolean;
  }>;
}

interface SacResp {
  periodo: { de: string; ate: string };
  // Backend retorna total como objeto { atual, anterior, variacao } —
  // mantemos opcional pra retrocompatibilidade
  total?: { atual: number; anterior: number; variacao: number } | number;
  abertas: number;
  emAndamento: number;
  resolvidas: number;
  canceladas?: number;
  slaEstourado: number;
  /** Backend usa `tmrHoras` */
  tmrHoras?: number;
  /** Alias antigo — mantido pra retrocompatibilidade */
  tempoMedioResolucaoHoras?: number;
  porSeveridade: Array<{ severidade: string; count: number }>;
  porTipo: Array<{ tipo: string; count: number }>;
}

interface AmostrasResp {
  periodo: { de: string; ate: string };
  enviadas: number;
  convertidas: number;
  /** Calculado client-side; backend não retorna direto */
  naoConverteram?: number;
  expiradas: number;
  taxaConversao: number;
  /** Backend devolve valorConvertido + valorTotal */
  valorConvertido: number;
  valorTotal?: number;
  porStatus?: Array<{ status: string; count: number; valor: number }>;
}

interface CampanhasResp {
  periodo: { de: string; ate: string };
  /** Backend usa totalCampanhas */
  totalCampanhas?: number;
  /** Alias antigo */
  total?: number;
  totalDestinatarios?: number;
  /** Alias antigo */
  totalEnvios?: number;
  totalLeituras?: number;
  taxaEnvio?: number;
  taxaLeitura: number;
  porCanal?: Array<{ canal: string; count?: number; envios?: number; leituras?: number }>;
  porStatus?: Array<{ status: string; count: number }>;
}

interface DashboardResp {
  vendas: VendasResp;
  funil: FunilResp;
  sac: SacResp;
  amostras: AmostrasResp;
  campanhas: CampanhasResp;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const STATUS_LABEL_PT: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  ENVIADO_OMIE: 'Enviado OMIE',
  PAGO: 'Pago',
  EM_SEPARACAO: 'Em separação',
  ENVIADO: 'Enviado',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};
const STATUS_COLOR_PT: Record<string, string> = {
  RASCUNHO: 'var(--muted)',
  AGUARDANDO_APROVACAO: 'var(--warning)',
  ENVIADO_OMIE: 'var(--info)',
  PAGO: 'var(--success)',
  EM_SEPARACAO: 'var(--magenta)',
  ENVIADO: 'var(--info)',
  ENTREGUE: 'var(--success)',
  CANCELADO: 'var(--danger)',
};

const ETAPA_LABEL: Record<string, string> = {
  NOVO: 'Novo',
  QUALIFICANDO: 'Qualificando',
  PROPOSTA: 'Proposta',
  NEGOCIACAO: 'Negociação',
  GANHO: 'Ganho',
  PERDIDO: 'Perdido',
};
const ETAPA_COLOR: Record<string, string> = {
  NOVO: 'var(--info)',
  QUALIFICANDO: 'var(--blue)',
  PROPOSTA: 'var(--warning)',
  NEGOCIACAO: 'var(--warning)',
  GANHO: 'var(--success)',
  PERDIDO: 'var(--danger)',
};

const SEV_COLOR: Record<string, string> = {
  baixa: 'var(--muted)',
  media: 'var(--info)',
  alta: 'var(--warning)',
  critica: 'var(--danger)',
};

// ─── Página principal ────────────────────────────────────────────────

export default function RelatoriosPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [periodo, setPeriodo] = useState<Periodo>('mes');

  const qs = useMemo(() => `?periodo=${periodo}`, [periodo]);

  return (
    <PageLayout
      title="Relatórios"
      actions={
        <Select
          value={periodo}
          data-testid="periodo-select"
          onChange={(e) => setPeriodo(e.target.value as Periodo)}
          style={{ minWidth: 160 }}
        >
          <option value="mes">Mês atual</option>
          <option value="trimestre">Últimos 90 dias</option>
          <option value="semestre">Últimos 180 dias</option>
          <option value="ano">Ano atual</option>
        </Select>
      }
    >
      {/* Tabs */}
      <div
        role="tablist"
        className="flex gap-0 border-b border-border mb-4 overflow-x-auto"
      >
        <TabButton current={tab} value="overview" onChange={setTab}>
          Visão geral
        </TabButton>
        <TabButton current={tab} value="vendas" onChange={setTab}>
          Vendas
        </TabButton>
        <TabButton current={tab} value="funil" onChange={setTab}>
          Funil
        </TabButton>
        <TabButton current={tab} value="comissoes" onChange={setTab}>
          Comissões
        </TabButton>
        <TabButton current={tab} value="sac" onChange={setTab}>
          SAC
        </TabButton>
        <TabButton current={tab} value="amostras" onChange={setTab}>
          Amostras
        </TabButton>
        <TabButton current={tab} value="campanhas" onChange={setTab}>
          Campanhas
        </TabButton>
      </div>

      {tab === 'overview' && <OverviewTab qs={qs} />}
      {tab === 'vendas' && <VendasTab qs={qs} />}
      {tab === 'funil' && <FunilTab qs={qs} />}
      {tab === 'comissoes' && <ComissoesTab qs={qs} />}
      {tab === 'sac' && <SacTab qs={qs} />}
      {tab === 'amostras' && <AmostrasTab qs={qs} />}
      {tab === 'campanhas' && <CampanhasTab qs={qs} />}
    </PageLayout>
  );
}

function TabButton({
  current,
  value,
  onChange,
  children,
}: {
  current: Tab;
  value: Tab;
  onChange: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`relatorios-tab-${value}`}
      onClick={() => onChange(value)}
      className={cn(
        'bg-transparent border-none border-b-2 px-4 py-[0.625rem] cursor-pointer font-[inherit] text-[14px] -mb-px whitespace-nowrap',
        active ? 'border-b-primary text-primary font-semibold' : 'border-b-transparent text-muted font-medium',
      )}
    >
      {children}
    </button>
  );
}

// ─── Tab: Overview ───────────────────────────────────────────────────

function OverviewTab({ qs }: { qs: string }) {
  const { data, loading, error, refetch } = useApiQuery<DashboardResp>(`/relatorios/dashboard${qs}`);

  return (
    <StateView loading={loading} error={error} onRetry={refetch}>
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* KPIs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.75rem',
            }}
          >
            <KPICard
              label="Faturamento"
              value={fmtBRLCompact(data.vendas.faturamento.atual)}
              variacao={data.vendas.faturamento.variacao}
            />
            <KPICard label="Pedidos" value={String(data.vendas.totalPedidos)} />
            <KPICard
              label="Ticket médio"
              value={fmtBRL(data.vendas.ticketMedio)}
            />
            <KPICard
              label="Taxa conversão leads"
              value={`${data.funil.taxaConversao ?? 0}%`}
              color={(data.funil.taxaConversao ?? 0) > 30 ? 'var(--success)' : (data.funil.taxaConversao ?? 0) > 15 ? 'var(--warning)' : 'var(--danger)'}
            />
            <KPICard
              label="SLA estourado"
              value={String(data.sac.slaEstourado)}
              color={data.sac.slaEstourado > 0 ? 'var(--danger)' : 'var(--success)'}
            />
            <KPICard
              label="Amostras convertidas"
              value={`${data.amostras.taxaConversao ?? 0}%`}
              hint={`${data.amostras.convertidas ?? 0}/${data.amostras.enviadas ?? 0}`}
            />
          </div>

          {/* Resumo Vendas + Funil */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="bg-surface border border-border rounded-[10px] p-6">
              <h3 className="m-0 mb-3 text-[15px]">Top representantes (vendas)</h3>
              <BarChart
                data={data.vendas.porRep.slice(0, 5).map((r) => ({
                  label: r.repNome,
                  sublabel: `${r.pedidos} pedido${r.pedidos === 1 ? '' : 's'}`,
                  value: r.total,
                }))}
                formatValue={fmtBRLCompact}
              />
            </div>
            <div className="bg-surface border border-border rounded-[10px] p-6">
              <h3 className="m-0 mb-3 text-[15px]">Funil de leads</h3>
              <Funnel
                stages={data.funil.funilAtual.map((e) => ({
                  label: ETAPA_LABEL[e.etapa] ?? e.etapa,
                  value: e.count,
                  color: ETAPA_COLOR[e.etapa],
                }))}
              />
            </div>
          </div>
        </div>
      )}
    </StateView>
  );
}

// ─── Tab: Vendas ─────────────────────────────────────────────────────

/**
 * Botões de export (CSV/Excel/PDF) reutilizáveis pra cada tab.
 * Recebe rows + columns + título — gera arquivo pronto pra download.
 */
function ExportActions<T>({
  filename,
  titulo,
  rows,
  columns,
  disabled,
}: {
  filename: string;
  titulo: string;
  rows: T[];
  columns: CsvColumn<T>[];
  disabled?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<'csv' | 'xlsx' | 'pdf' | null>(null);

  async function doCsv() {
    setBusy('csv');
    try {
      const csv = toCsv(rows, columns);
      downloadCsv(`${filename}.csv`, csv);
      toast.success(`${rows.length} linhas exportadas (CSV)`);
    } catch (err) {
      toast.error('Falha ao exportar CSV', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  async function doXlsx() {
    setBusy('xlsx');
    try {
      await rowsToXlsx({ rows, filename: `${filename}.xlsx`, columns, sheetName: titulo });
      toast.success(`${rows.length} linhas exportadas (Excel)`);
    } catch (err) {
      toast.error('Falha ao exportar Excel', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  async function doPdf() {
    setBusy('pdf');
    try {
      const headers = columns.map((c) => c.header);
      const tabela = {
        cabecalho: headers,
        linhas: rows.map((r) => columns.map((c) => c.value(r) ?? '')),
      };
      await gerarPdf({
        filename: `${filename}.pdf`,
        titulo,
        subtitulo: `Gerado em ${new Date().toLocaleString('pt-BR')}`,
        secoes: [{ tabela }],
        orientacao: 'landscape',
      });
      toast.success(`${rows.length} linhas exportadas (PDF)`);
    } catch (err) {
      toast.error('Falha ao exportar PDF', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  const btnClass =
    'bg-surface text-text border border-border-strong rounded-md px-[0.625rem] py-1 text-[12px] font-medium cursor-pointer tracking-[-0.1px]';
  const btnStyle: React.CSSProperties = {
    opacity: disabled || busy !== null ? 0.6 : 1,
  };

  return (
    <div className="flex gap-[0.375rem] items-center">
      <span className="text-[11px] text-muted">Exportar:</span>
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={doCsv}
        className={btnClass}
        style={btnStyle}
        data-testid="export-csv"
      >
        {busy === 'csv' ? '…' : 'CSV'}
      </button>
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={doXlsx}
        className={btnClass}
        style={btnStyle}
        data-testid="export-xlsx"
      >
        {busy === 'xlsx' ? '…' : 'Excel'}
      </button>
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={doPdf}
        className={btnClass}
        style={btnStyle}
        data-testid="export-pdf"
      >
        {busy === 'pdf' ? '…' : 'PDF'}
      </button>
    </div>
  );
}

function VendasTab({ qs }: { qs: string }) {
  const { data, loading, error, refetch } = useApiQuery<VendasResp>(`/relatorios/vendas${qs}`);

  return (
    <StateView loading={loading} error={error} onRetry={refetch}>
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Export actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ExportActions
              filename={`vendas-${new Date().toISOString().slice(0, 10)}`}
              titulo="Relatório de Vendas"
              rows={data.porRep}
              columns={[
                { header: 'Representante', value: (r) => r.repNome },
                { header: 'Pedidos', value: (r) => r.pedidos },
                { header: 'Total (R$)', value: (r) => r.total.toFixed(2).replace('.', ',') },
              ]}
              disabled={data.porRep.length === 0}
            />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.75rem',
            }}
          >
            <KPICard
              label="Faturamento total"
              value={fmtBRL(data.faturamento.atual)}
              variacao={data.faturamento.variacao}
              hint={`Período anterior: ${fmtBRL(data.faturamento.anterior)}`}
            />
            <KPICard
              label="Receita realizada"
              value={fmtBRL(data.receitaRealizada)}
              hint="Apenas pedidos ENTREGUE"
              color="var(--success)"
            />
            <KPICard label="Total de pedidos" value={String(data.totalPedidos)} />
            <KPICard label="Ticket médio" value={fmtBRL(data.ticketMedio)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="bg-surface border border-border rounded-[10px] p-6">
              <h3 className="m-0 mb-3 text-[15px]">Pedidos por status</h3>
              <Donut
                slices={data.porStatus.map((s) => ({
                  label: STATUS_LABEL_PT[s.status] ?? s.status,
                  value: s.count,
                  color: STATUS_COLOR_PT[s.status] ?? 'var(--muted)',
                }))}
              />
            </div>
            <div className="bg-surface border border-border rounded-[10px] p-6">
              <h3 className="m-0 mb-3 text-[15px]">Faturamento por status</h3>
              <BarChart
                data={data.porStatus
                  .filter((s) => s.total > 0)
                  .map((s) => ({
                    label: STATUS_LABEL_PT[s.status] ?? s.status,
                    sublabel: `${s.count} pedido${s.count === 1 ? '' : 's'}`,
                    value: s.total,
                    color: STATUS_COLOR_PT[s.status] ?? 'var(--muted)',
                  }))}
                formatValue={fmtBRLCompact}
              />
            </div>
          </div>

          <div className="bg-surface border border-border rounded-[10px] p-6">
            <h3 className="m-0 mb-3 text-[15px]">Ranking representantes</h3>
            <BarChart
              data={data.porRep.map((r) => ({
                label: r.repNome,
                sublabel: `${r.pedidos} pedido${r.pedidos === 1 ? '' : 's'}`,
                value: r.total,
              }))}
              maxBars={20}
              formatValue={fmtBRLCompact}
            />
          </div>
        </div>
      )}
    </StateView>
  );
}

// ─── Tab: Funil ──────────────────────────────────────────────────────

function FunilTab({ qs }: { qs: string }) {
  const { data, loading, error, refetch } = useApiQuery<FunilResp>(`/relatorios/funil${qs}`);

  // Defesa em profundidade contra payload incompleto/edge cases —
  // antes uma resposta sem `porRep` ou `agingMedioPorEtapa` derrubava
  // o render inteiro pro ErrorBoundary (fix B6).
  const funilAtual = data?.funilAtual ?? [];
  const aging = data?.agingMedioPorEtapa ?? {};
  const porRep = data?.porRep ?? [];
  const totalAtivos = data?.totalAtivos ?? 0;
  const criadosAtual = data?.criados?.atual ?? 0;
  const criadosVariacao = data?.criados?.variacao;
  const ganhosAtual = data?.ganhos?.atual ?? 0;
  const ganhosVariacao = data?.ganhos?.variacao;
  const perdidos = data?.perdidos ?? 0;
  const taxaConversao = data?.taxaConversao ?? 0;

  return (
    <StateView loading={loading} error={error} onRetry={refetch}>
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ExportActions
              filename={`funil-${new Date().toISOString().slice(0, 10)}`}
              titulo="Relatório de Funil (por representante)"
              rows={porRep}
              columns={[
                { header: 'Representante', value: (r) => r.repNome },
                { header: 'Leads', value: (r) => r.leads },
                {
                  header: 'Valor estimado (R$)',
                  value: (r) => r.valorEstimado.toFixed(2).replace('.', ','),
                },
              ]}
              disabled={porRep.length === 0}
            />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '0.75rem',
            }}
          >
            <KPICard label="Leads ativos" value={String(totalAtivos)} />
            <KPICard
              label="Criados"
              value={String(criadosAtual)}
              variacao={criadosVariacao}
            />
            <KPICard
              label="Ganhos"
              value={String(ganhosAtual)}
              variacao={ganhosVariacao}
              color="var(--success)"
            />
            <KPICard
              label="Perdidos"
              value={String(perdidos)}
              color={perdidos > 0 ? 'var(--danger)' : 'var(--muted)'}
            />
            <KPICard
              label="Taxa conversão"
              value={`${taxaConversao}%`}
              color={taxaConversao > 30 ? 'var(--success)' : taxaConversao > 15 ? 'var(--warning)' : 'var(--danger)'}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="bg-surface border border-border rounded-[10px] p-6">
              <h3 className="m-0 mb-3 text-[15px]">Funil atual</h3>
              <Funnel
                stages={funilAtual.map((e) => ({
                  label: ETAPA_LABEL[e.etapa] ?? e.etapa,
                  value: e.count ?? 0,
                  color: ETAPA_COLOR[e.etapa],
                })) as FunnelStage[]}
              />
            </div>
            <div className="bg-surface border border-border rounded-[10px] p-6">
              <h3 className="m-0 mb-3 text-[15px]">Valor estimado por etapa</h3>
              <BarChart
                data={funilAtual.map((e) => ({
                  label: ETAPA_LABEL[e.etapa] ?? e.etapa,
                  value: e.valorEstimado ?? 0,
                  color: ETAPA_COLOR[e.etapa],
                }))}
                formatValue={fmtBRLCompact}
              />
            </div>
          </div>

          {Object.keys(aging).length > 0 && (
            <div className="bg-surface border border-border rounded-[10px] p-6">
              <h3 className="m-0 mb-3 text-[15px]">
                Aging médio por etapa (dias parados)
              </h3>
              <BarChart
                data={Object.entries(aging).map(([etapa, dias]) => ({
                  label: ETAPA_LABEL[etapa] ?? etapa,
                  value: dias ?? 0,
                  color: (dias ?? 0) > 14 ? 'var(--warning)' : ETAPA_COLOR[etapa],
                }))}
                formatValue={(v) => `${v}d`}
              />
            </div>
          )}

          <div className="bg-surface border border-border rounded-[10px] p-6">
            <h3 className="m-0 mb-3 text-[15px]">Leads por representante</h3>
            <BarChart
              data={porRep.map((r) => ({
                label: r.repNome ?? '—',
                sublabel: `${r.leads ?? 0} lead${(r.leads ?? 0) === 1 ? '' : 's'}`,
                value: r.valorEstimado ?? 0,
              }))}
              maxBars={20}
              formatValue={fmtBRLCompact}
            />
          </div>
        </div>
      )}
    </StateView>
  );
}

// ─── Tab: Comissões ──────────────────────────────────────────────────

function ComissoesTab({ qs }: { qs: string }) {
  const { data, loading, error, refetch } = useApiQuery<ComissoesResp>(`/relatorios/comissoes${qs}`);

  // Defesa em profundidade (fix B6, igual aos outros tabs): o backend devolve
  // `pago`/`aPagar`/`detalhes`; versões antigas usavam `totalPago`/`totalAPagar`/
  // `porRep`. Sem normalizar, `data.porRep.length` jogava o render inteiro pro
  // ErrorBoundary quando o payload vinha no formato atual (porRep === undefined).
  const totalPago = data?.pago ?? data?.totalPago ?? 0;
  const totalAPagar = data?.aPagar ?? data?.totalAPagar ?? 0;
  const linhasRaw = data?.detalhes ?? data?.porRep ?? [];
  const linhas = linhasRaw.map((r) => ({
    nome:
      ('representanteNome' in r ? r.representanteNome : undefined) ??
      ('repNome' in r ? r.repNome : undefined) ??
      '—',
    tipo: r.tipo,
    valor: r.totalComissao ?? r.valor ?? 0,
    pago: r.pago,
  }));

  return (
    <StateView loading={loading} error={error} onRetry={refetch}>
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ExportActions
              filename={`comissoes-${new Date().toISOString().slice(0, 10)}`}
              titulo="Relatório de Comissões"
              rows={linhas}
              columns={[
                { header: 'Representante', value: (r) => r.nome },
                { header: 'Tipo', value: (r) => r.tipo },
                { header: 'Valor (R$)', value: (r) => r.valor.toFixed(2).replace('.', ',') },
                { header: 'Status', value: (r) => (r.pago ? 'Pago' : 'A pagar') },
              ]}
              disabled={linhas.length === 0}
            />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem',
            }}
          >
            <KPICard
              label="Total pago"
              value={fmtBRL(totalPago)}
              color="var(--success)"
            />
            <KPICard
              label="Total a pagar"
              value={fmtBRL(totalAPagar)}
              color={totalAPagar > 0 ? 'var(--warning)' : 'var(--muted)'}
            />
            <KPICard
              label="Total geral"
              value={fmtBRL(totalPago + totalAPagar)}
            />
          </div>

          <div className="bg-surface border border-border rounded-[10px] p-6">
            <h3 className="m-0 mb-3 text-[15px]">Comissões por representante</h3>
            <BarChart
              data={linhas.map((r) => ({
                label: r.nome,
                sublabel: r.pago ? '✓ pago' : '⏳ a pagar',
                value: r.valor,
                color: r.pago ? 'var(--success)' : 'var(--warning)',
              }))}
              maxBars={20}
              formatValue={fmtBRLCompact}
            />
            <p className="text-[12px] text-muted mt-3">
              Tipo: REP = comissão de pedidos próprios; GERENTE = % sobre vendas dos representantes da
              gerência.
            </p>
          </div>
        </div>
      )}
    </StateView>
  );
}

// ─── Tab: SAC ────────────────────────────────────────────────────────

function SacTab({ qs }: { qs: string }) {
  const { data, loading, error, refetch } = useApiQuery<SacResp>(`/relatorios/sac${qs}`);

  return (
    <StateView loading={loading} error={error} onRetry={refetch}>
      {data && (() => {
        // Defensive defaults — backend pode retornar campos undefined
        const total =
          typeof data.total === 'object' && data.total !== null
            ? data.total.atual
            : (data.total as number | undefined) ?? 0;
        const tmr = data.tmrHoras ?? data.tempoMedioResolucaoHoras;
        const porSeveridade = data.porSeveridade ?? [];
        const porTipo = data.porTipo ?? [];
        // Junta severidade + tipo em uma única tabela pra export
        const rowsExport = [
          ...porSeveridade.map((s) => ({ grupo: 'Severidade', label: s.severidade, count: s.count })),
          ...porTipo.map((t) => ({ grupo: 'Tipo', label: t.tipo, count: t.count })),
        ];
        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ExportActions
              filename={`sac-${new Date().toISOString().slice(0, 10)}`}
              titulo="Relatório SAC"
              rows={rowsExport}
              columns={[
                { header: 'Grupo', value: (r) => r.grupo },
                { header: 'Categoria', value: (r) => r.label },
                { header: 'Quantidade', value: (r) => r.count },
              ]}
              disabled={rowsExport.length === 0}
            />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '0.75rem',
            }}
          >
            <KPICard label="Total ocorrências" value={String(total)} />
            <KPICard label="Abertas" value={String(data.abertas ?? 0)} color="var(--warning)" />
            <KPICard label="Em andamento" value={String(data.emAndamento ?? 0)} color="var(--info)" />
            <KPICard
              label="Resolvidas"
              value={String(data.resolvidas ?? 0)}
              color="var(--success)"
            />
            <KPICard
              label="SLA estourado"
              value={String(data.slaEstourado ?? 0)}
              color={(data.slaEstourado ?? 0) > 0 ? 'var(--danger)' : 'var(--muted)'}
            />
            {tmr !== undefined && (
              <KPICard
                label="Tempo médio resolução"
                value={`${tmr}h`}
              />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="bg-surface border border-border rounded-[10px] p-6">
              <h3 className="m-0 mb-3 text-[15px]">Por severidade</h3>
              <Donut
                slices={
                  porSeveridade.map((s) => ({
                    label: s.severidade.toUpperCase(),
                    value: s.count,
                    color: SEV_COLOR[s.severidade] ?? 'var(--muted)',
                  })) as DonutSlice[]
                }
              />
            </div>
            <div className="bg-surface border border-border rounded-[10px] p-6">
              <h3 className="m-0 mb-3 text-[15px]">Por tipo</h3>
              <BarChart
                data={porTipo.map((t) => ({
                  label: t.tipo,
                  value: t.count,
                }))}
              />
            </div>
          </div>
        </div>
        );
      })()}
    </StateView>
  );
}

// ─── Tab: Amostras ───────────────────────────────────────────────────

function AmostrasTab({ qs }: { qs: string }) {
  const { data, loading, error, refetch } = useApiQuery<AmostrasResp>(`/relatorios/amostras${qs}`);

  return (
    <StateView loading={loading} error={error} onRetry={refetch}>
      {data && (() => {
        const enviadas = data.enviadas ?? 0;
        const convertidas = data.convertidas ?? 0;
        const expiradas = data.expiradas ?? 0;
        // Calcula naoConverteram se backend não retornou (algumas versões não)
        const naoConverteram =
          data.naoConverteram ??
          // fallback: usa porStatus.NAO_CONVERTEU se existir
          data.porStatus?.find((s) => s.status === 'NAO_CONVERTEU')?.count ?? 0;
        const taxaConversao = data.taxaConversao ?? 0;
        const valorConvertido = data.valorConvertido ?? 0;
        const porStatus = data.porStatus ?? [];
        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ExportActions
              filename={`amostras-${new Date().toISOString().slice(0, 10)}`}
              titulo="Relatório de Amostras (por status)"
              rows={porStatus}
              columns={[
                { header: 'Status', value: (s) => s.status },
                { header: 'Quantidade', value: (s) => s.count },
                { header: 'Valor (R$)', value: (s) => s.valor.toFixed(2).replace('.', ',') },
              ]}
              disabled={porStatus.length === 0}
            />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '0.75rem',
            }}
          >
            <KPICard label="Enviadas" value={String(enviadas)} />
            <KPICard
              label="Convertidas"
              value={String(convertidas)}
              color="var(--success)"
            />
            <KPICard
              label="Não converteram"
              value={String(naoConverteram)}
              color="var(--muted)"
            />
            <KPICard
              label="Expiradas"
              value={String(expiradas)}
              color={expiradas > 0 ? 'var(--warning)' : 'var(--muted)'}
            />
            <KPICard
              label="Taxa conversão"
              value={`${taxaConversao}%`}
              color={taxaConversao > 30 ? 'var(--success)' : taxaConversao > 15 ? 'var(--warning)' : 'var(--danger)'}
            />
            <KPICard
              label="Valor convertido"
              value={fmtBRL(valorConvertido)}
              hint="Pedidos gerados a partir de amostras"
            />
          </div>

          <div className="bg-surface border border-border rounded-[10px] p-6">
            <h3 className="m-0 mb-3 text-[15px]">Distribuição</h3>
            <Donut
              slices={[
                {
                  label: 'Convertidas',
                  value: convertidas,
                  color: 'var(--success)',
                },
                {
                  label: 'Não converteram',
                  value: naoConverteram,
                  color: 'var(--muted)',
                },
                {
                  label: 'Expiradas',
                  value: expiradas,
                  color: 'var(--warning)',
                },
                {
                  label: 'Pendentes',
                  value: Math.max(
                    0,
                    enviadas - convertidas - naoConverteram - expiradas,
                  ),
                  color: 'var(--info)',
                },
              ]}
            />
          </div>
        </div>
        );
      })()}
    </StateView>
  );
}

// ─── Tab: Campanhas ──────────────────────────────────────────────────

function CampanhasTab({ qs }: { qs: string }) {
  const { data, loading, error, refetch } = useApiQuery<CampanhasResp>(`/relatorios/campanhas${qs}`);

  return (
    <StateView loading={loading} error={error} onRetry={refetch}>
      {data && (() => {
        // Backend usa totalCampanhas / totalDestinatarios; legados podem usar
        // total / totalEnvios. Tolera ambos.
        const totalCamp = data.totalCampanhas ?? data.total ?? 0;
        const totalEnvios = data.totalDestinatarios ?? data.totalEnvios ?? 0;
        const taxaLeitura = data.taxaLeitura ?? 0;
        const porCanal = data.porCanal ?? [];
        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ExportActions
              filename={`campanhas-${new Date().toISOString().slice(0, 10)}`}
              titulo="Relatório de Campanhas (por canal)"
              rows={porCanal}
              columns={[
                { header: 'Canal', value: (c) => c.canal },
                { header: 'Envios', value: (c) => c.count ?? c.envios ?? 0 },
                { header: 'Leituras', value: (c) => c.leituras ?? 0 },
              ]}
              disabled={porCanal.length === 0}
            />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '0.75rem',
            }}
          >
            <KPICard label="Campanhas" value={String(totalCamp)} />
            <KPICard label="Total de envios" value={String(totalEnvios)} />
            <KPICard label="Taxa de envio" value={`${data.taxaEnvio ?? 0}%`} />
            <KPICard
              label="Taxa de leitura"
              value={`${taxaLeitura}%`}
              color={taxaLeitura > 50 ? 'var(--success)' : taxaLeitura > 25 ? 'var(--warning)' : 'var(--danger)'}
            />
          </div>

          {porCanal.length > 0 ? (
            <div className="bg-surface border border-border rounded-[10px] p-6">
              <h3 className="m-0 mb-3 text-[15px]">Performance por canal</h3>
              <BarChart
                data={porCanal.map((c) => ({
                  label: c.canal,
                  sublabel: `${c.count ?? c.envios ?? 0} campanha${(c.count ?? c.envios ?? 0) === 1 ? '' : 's'}`,
                  value: c.count ?? c.envios ?? 0,
                }))}
              />
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-[10px] p-6">
              <p className="text-muted text-[13px] m-0">
                Nenhuma campanha no período. Quando você criar campanhas via Fluxos de Automação,
                as métricas aparecem aqui.
              </p>
            </div>
          )}

          <div className="bg-surface border border-border rounded-[10px] p-6">
            <p className="text-muted text-[12px] m-0">
              💡 Módulo de Campanhas (CRUD direto, sem fluxo) está planejado pra próxima fase.
              Por enquanto, campanhas são disparadas via Fluxos de Automação (trigger →{' '}
              <span className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] bg-info/12 text-info border border-info/19">ENVIAR_WHATSAPP</span> /{' '}
              <span className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] bg-info/12 text-info border border-info/19">ENVIAR_EMAIL</span>).
            </p>
          </div>
        </div>
        );
      })()}
    </StateView>
  );
}
