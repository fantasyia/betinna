import { useMemo, useState } from 'react';
import { ScrollX } from '@/components/ui/ScrollX';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { usePermission } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { VendasTabs } from '@/components/VendasTabs';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar } from '@/components/FilterBar';
import { Dialog } from '@/components/ui';
import { FormField, Input, Select } from '@/components/FormField';
import { cn } from '@/lib/cn';
import { formatMoeda as fmtBRL, formatPercent } from '@/lib/masks';

type ComissaoTipo = 'REP' | 'GERENTE' | 'SITE';

/**
 * Espelha o `Comissao` do banco — nomes IGUAIS aos do backend.
 *
 * A tela usava `valor`/`totalVendido`, campos que a API nunca devolveu: o
 * dinheiro saía como R$ 0,00 na lista e o resumo do rep quebrava a página
 * inteira. Nome inventado no front é erro que só aparece em produção — o teste
 * mockava o mesmo chute e passava.
 */
interface Comissao {
  id: string;
  mes: number;
  ano: number;
  tipo: ComissaoTipo;
  representante?: { id: string; nome: string };
  totalVendas: number;
  totalComissao: number;
  qtdPedidos?: number;
  percentual: number | null;
  pago: boolean;
  pagoEm?: string | null;
  reciboUrl?: string | null;
}

/** `GET /comissoes/meu-resumo` — o que o REP/GERENTE vê de si. */
interface Resumo {
  representanteId: string;
  anoAtual: number;
  totalRecebidoAnoAtual: number;
  totalAReceberAnoAtual: number;
  /** Os 12 lançamentos mais recentes (pode ter REP e GERENTE no mesmo mês). */
  historico: Comissao[];
}

/** `GET /comissoes/minha-previsao` — o "quanto vou receber, e quando". */
interface Previsao {
  mes: number;
  ano: number;
  base: number;
  valor: number;
  qtdPedidos: number;
  previsaoPagamentoEm: string;
  fechado: boolean;
  pedidos: Array<{
    pedidoId: string;
    numero: string;
    cliente: string;
    data: string | null;
    totalPedido: number;
    comissao: number;
  }>;
}

/** `GET /comissoes/minhas-recebidas` — extrato do que ja caiu. */
interface Recebidas {
  total: number;
  itens: Array<{
    id: string;
    mes: number;
    ano: number;
    tipo: string;
    totalVendas: number;
    totalComissao: number;
    qtdPedidos: number;
    pagoEm: string | null;
    previsaoPagamentoEm: string;
  }>;
}

const MES_NOMES = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

/** '2026-08-05' -> '05/08/2026' (a data que o rep procura e a do pagamento). */
function fmtData(iso: string | null | undefined) {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function fmtPct(p: number | null | undefined) {
  const n = typeof p === 'number' && Number.isFinite(p) ? p : 0;
  return formatPercent(n, 2);
}

export default function ComissoesPage() {
  const canViewOwn = usePermission('comissoes.own');
  const canViewAllGlobal = usePermission('comissoes.all');
  const canViewTeam = usePermission('comissoes.team');
  const canViewAll = canViewAllGlobal || canViewTeam;

  return (
    <PageLayout title="Comissões">
      <VendasTabs />
      {canViewOwn && <ResumoPessoal />}
      {canViewAll && <ListaAdmin />}
      {!canViewOwn && !canViewAll && (
        <div className="bg-surface border border-border rounded-[10px] p-6">
          Você não tem permissão para visualizar comissões.
        </div>
      )}
    </PageLayout>
  );
}

// ─── Resumo pessoal (REP/GERENTE) ──────────────────────────────────────

function ResumoPessoal() {
  const { data, loading, error, refetch } = useApiQuery<Resumo>('/comissoes/meu-resumo');
  // "Como quero ver": o consolidado responde "quanto"; o detalhado responde "de
  // onde saiu" — e e o detalhe que evita a discussao no fim do mes.
  const [visao, setVisao] = useState<'consolidado' | 'detalhado'>('consolidado');
  const [aba, setAba] = useState<'receber' | 'recebidas'>('receber');

  return (
    <section className="bg-surface border border-border rounded-[10px] p-6 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="m-0 text-[18px]">Minhas comissões</h2>
        <div className="flex gap-1 p-0.5 rounded-md bg-bg-alt border border-border">
          {(['receber', 'recebidas'] as const).map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`comissao-aba-${k}`}
              onClick={() => setAba(k)}
              className={cn(
                'px-3 py-1 rounded text-[12px] font-medium transition-colors',
                aba === k ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
              )}
            >
              {k === 'receber' ? 'A receber' : 'Recebidas'}
            </button>
          ))}
        </div>
      </div>

      {aba === 'receber' ? (
        <>
          <PrevisaoDoMes visao={visao} onVisao={setVisao} />
          <StateView loading={loading} error={error} onRetry={refetch}>
            {data && (
              <div className="mt-5">
                <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-4">
                  <StatBox
                    label={`A receber em ${data.anoAtual}`}
                    value={fmtBRL(data.totalAReceberAnoAtual ?? 0)}
                    color="var(--warning)"
                  />
                  <StatBox
                    label={`Recebido em ${data.anoAtual}`}
                    value={fmtBRL(data.totalRecebidoAnoAtual ?? 0)}
                    color="var(--success)"
                  />
                </div>
                <h3 className="text-[14px] mb-2">Últimos lançamentos</h3>
                {(data.historico ?? []).length === 0 ? (
                  <p className="text-[13px] text-muted m-0">
                    Nenhuma comissão fechada ainda. Elas aparecem aqui quando o mês é fechado.
                  </p>
                ) : (
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {data.historico.map((c) => (
                      <div
                        key={c.id}
                        data-testid="comissao-historico"
                        className={cn(
                          'flex-[1_1_86px] min-w-[86px] p-2 rounded-md text-center border border-border',
                          c.pago ? 'bg-success/8' : 'bg-bg-alt',
                        )}
                      >
                        <div className="text-[11px] text-muted">
                          {MES_NOMES[c.mes - 1]}/{String(c.ano).slice(2)}
                        </div>
                        <div className="font-semibold text-[13px] mt-0.5">
                          {fmtBRL(c.totalComissao)}
                        </div>
                        <div className="text-[10px] text-muted mt-0.5">{c.tipo}</div>
                        {c.pago && (
                          <div className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[9px] font-semibold leading-[1.6] tracking-[0.2px] bg-success/12 text-success border border-success/19 mt-1">
                            pago
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </StateView>
        </>
      ) : (
        <Recebimentos />
      )}
    </section>
  );
}

/**
 * O mes corrente ANTES do fechamento.
 *
 * Sem isto o rep passava o mes inteiro sem ver o que vendeu — o numero so
 * aparecia depois que a gestao fechava a folha.
 */
function PrevisaoDoMes({
  visao,
  onVisao,
}: {
  visao: 'consolidado' | 'detalhado';
  onVisao: (v: 'consolidado' | 'detalhado') => void;
}) {
  const { data, loading, error, refetch } = useApiQuery<Previsao>('/comissoes/minha-previsao');

  return (
    <StateView loading={loading} error={error} onRetry={refetch}>
      {data && (
        <div className="rounded-[10px] border border-border bg-bg-alt p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[12px] text-muted">
                {data.fechado ? 'Fechado' : 'Previsão'} · {MES_NOMES[data.mes - 1]}/{data.ano}
              </div>
              <div
                className="text-[26px] font-semibold leading-tight"
                data-testid="comissao-previsao-valor"
              >
                {fmtBRL(data.valor)}
              </div>
              <div className="text-[12px] text-muted mt-0.5">
                {data.qtdPedidos} pedido{data.qtdPedidos === 1 ? '' : 's'} · {fmtBRL(data.base)}{' '}
                vendidos · pagamento previsto em{' '}
                <strong className="text-text">{fmtData(data.previsaoPagamentoEm)}</strong>
              </div>
            </div>
            <div className="flex gap-1 p-0.5 rounded-md bg-surface border border-border">
              {(['consolidado', 'detalhado'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  data-testid={`comissao-visao-${v}`}
                  onClick={() => onVisao(v)}
                  className={cn(
                    'px-3 py-1 rounded text-[12px] font-medium transition-colors',
                    visao === v ? 'bg-bg-alt text-text' : 'text-muted hover:text-text',
                  )}
                >
                  {v === 'consolidado' ? 'Consolidado' : 'Detalhado'}
                </button>
              ))}
            </div>
          </div>

          {visao === 'detalhado' && (
            <div className="mt-3 overflow-x-auto" data-testid="comissao-previsao-detalhe">
              {data.pedidos.length === 0 ? (
                <p className="text-[13px] text-muted m-0">
                  Nenhum pedido atribuído a você neste mês ainda.
                </p>
              ) : (
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="text-muted text-[11px] uppercase tracking-wide">
                      <th className="text-left font-medium py-1.5">Pedido</th>
                      <th className="text-left font-medium py-1.5">Cliente</th>
                      <th className="text-left font-medium py-1.5">Data</th>
                      <th className="text-right font-medium py-1.5">Venda</th>
                      <th className="text-right font-medium py-1.5">Comissão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pedidos.map((p) => (
                      <tr key={p.pedidoId} className="border-t border-border">
                        <td className="py-1.5">{p.numero}</td>
                        <td className="py-1.5">{p.cliente}</td>
                        <td className="py-1.5">{fmtData(p.data)}</td>
                        <td className="py-1.5 text-right">{fmtBRL(p.totalPedido)}</td>
                        <td className="py-1.5 text-right font-medium">{fmtBRL(p.comissao)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </StateView>
  );
}

/** Extrato do que ja caiu, filtrado pela data do PAGAMENTO. */
function Recebimentos() {
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const qs = new URLSearchParams();
  if (de) qs.set('de', de);
  if (ate) qs.set('ate', ate);
  const { data, loading, error, refetch } = useApiQuery<Recebidas>(
    `/comissoes/minhas-recebidas${qs.toString() ? `?${qs.toString()}` : ''}`,
  );

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <FormField label="De">
          <Input
            type="date"
            value={de}
            data-testid="comissao-recebidas-de"
            onChange={(e) => setDe(e.target.value)}
          />
        </FormField>
        <FormField label="Até">
          <Input
            type="date"
            value={ate}
            data-testid="comissao-recebidas-ate"
            onChange={(e) => setAte(e.target.value)}
          />
        </FormField>
        {(de || ate) && (
          <button
            type="button"
            className="text-[12px] text-muted hover:text-text underline pb-2"
            onClick={() => {
              setDe('');
              setAte('');
            }}
          >
            limpar
          </button>
        )}
      </div>
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <>
            <StatBox
              label="Total recebido no período"
              value={fmtBRL(data.total)}
              color="var(--success)"
            />
            {data.itens.length === 0 ? (
              <p className="text-[13px] text-muted mt-4 mb-0">Nenhuma comissão paga no período.</p>
            ) : (
              <ScrollX className="mt-4">
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="text-muted text-[11px] uppercase tracking-wide">
                      <th className="text-left font-medium py-1.5">Competência</th>
                      <th className="text-left font-medium py-1.5">Tipo</th>
                      <th className="text-left font-medium py-1.5">Pago em</th>
                      <th className="text-right font-medium py-1.5">Vendas</th>
                      <th className="text-right font-medium py-1.5">Comissão</th>
                    </tr>
                  </thead>
                  <tbody data-testid="comissao-recebidas-lista">
                    {data.itens.map((c) => (
                      <tr key={c.id} className="border-t border-border">
                        <td className="py-1.5">
                          {MES_NOMES[c.mes - 1]}/{c.ano}
                        </td>
                        <td className="py-1.5">{c.tipo}</td>
                        <td className="py-1.5">{fmtData(c.pagoEm)}</td>
                        <td className="py-1.5 text-right">{fmtBRL(c.totalVendas)}</td>
                        <td className="py-1.5 text-right font-medium">{fmtBRL(c.totalComissao)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollX>
            )}
          </>
        )}
      </StateView>
    </div>
  );
}

function StatBox({
  label,
  value,
  hint,
  color = 'var(--text)',
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div className="bg-bg-alt border border-border rounded-md p-3">
      <div className="text-[11px] uppercase text-muted font-semibold">{label}</div>
      <div className="text-[22px] font-bold mt-1" style={{ color }}>
        {value}
      </div>
      {hint && <div className="text-[12px] text-muted mt-0.5">{hint}</div>}
    </div>
  );
}

// ─── Lista admin (ADMIN/DIRECTOR/GERENTE) ──────────────────────────────

function ListaAdmin() {
  // D46+D48: fechar mês / marcar pago / desmarcar = DIRECTOR (mandatário do
  // tenant) OU ADMIN (master da plataforma). GERENTE só visualiza.
  const canManage = usePermission('comissoes.manage');
  const [page, setPage] = useState(1);
  const now = new Date();
  const [mes, setMes] = useState<number | ''>(now.getMonth() + 1);
  const [ano, setAno] = useState<number>(now.getFullYear());
  const [pago, setPago] = useState<string>('');

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({
      page: String(page),
      limit: '20',
      ano: String(ano),
    });
    if (mes !== '') qs.set('mes', String(mes));
    if (pago) qs.set('pago', pago);
    return `/comissoes?${qs.toString()}`;
  }, [page, mes, ano, pago]);

  const {
    data: pageResp,
    loading,
    error,
    refetch,
  } = useApiQuery<PaginatedResponse<Comissao>>(listPath);

  const [fecharOpen, setFecharOpen] = useState(false);
  const [pagar, setPagar] = useState<Comissao | null>(null);

  const columns: Column<Comissao>[] = [
    {
      key: 'periodo',
      header: 'Período',
      render: (c) => `${MES_NOMES[c.mes - 1]}/${c.ano}`,
    },
    {
      key: 'rep',
      header: 'Representante',
      render: (c) => (
        <div>
          <div>{c.representante?.nome ?? '—'}</div>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-[9px] py-0.5 text-[10px] font-semibold leading-[1.6] tracking-[0.2px] border',
              c.tipo === 'GERENTE'
                ? 'bg-warning/12 text-warning border-warning/19'
                : c.tipo === 'SITE'
                  ? 'bg-magenta/12 text-magenta border-magenta/19'
                  : 'bg-info/12 text-info border-info/19',
            )}
          >
            {c.tipo}
          </span>
        </div>
      ),
    },
    {
      key: 'vendido',
      header: 'Vendido',
      render: (c) => fmtBRL(c.totalVendas),
    },
    {
      key: 'percentual',
      header: '%',
      render: (c) => fmtPct(c.percentual),
    },
    {
      key: 'valor',
      header: 'Comissão',
      render: (c) => <strong>{fmtBRL(c.totalComissao)}</strong>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) =>
        c.pago ? (
          <span className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] bg-success/12 text-success border border-success/19">
            Pago
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] bg-warning/12 text-warning border border-warning/19">
            Em aberto
          </span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (c) =>
        canManage && !c.pago ? (
          <button
            type="button"
            data-testid={`comissao-pagar-${c.id}`}
            onClick={() => setPagar(c)}
            className="bg-surface text-text border border-border-strong rounded-md px-2.5 py-1 text-[12px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Marcar pago
          </button>
        ) : null,
    },
  ];

  return (
    <section className="bg-surface border border-border rounded-[10px] p-6">
      <header className="flex justify-between items-center mb-3">
        <h2 className="m-0 text-[18px]">Comissões da equipe</h2>
        {canManage && (
          <button
            type="button"
            data-testid="fechar-mes-btn"
            onClick={() => setFecharOpen(true)}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
          >
            Fechar mês
          </button>
        )}
      </header>

      <FilterBar>
        <Select
          data-testid="filter-mes"
          value={mes}
          onChange={(e) => {
            setMes(e.target.value === '' ? '' : Number(e.target.value));
            setPage(1);
          }}
        >
          <option value="">Todos meses</option>
          {MES_NOMES.map((n, i) => (
            <option key={i} value={i + 1}>
              {n}
            </option>
          ))}
        </Select>
        <Select
          data-testid="filter-ano"
          value={ano}
          onChange={(e) => {
            setAno(Number(e.target.value));
            setPage(1);
          }}
        >
          {[ano - 1, ano, ano + 1].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select
          data-testid="filter-pago"
          value={pago}
          onChange={(e) => {
            setPago(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Pagos + abertos</option>
          <option value="true">Apenas pagos</option>
          <option value="false">Apenas em aberto</option>
        </Select>
      </FilterBar>

      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
        emptyMessage="Nenhuma comissão encontrada nesse filtro."
        onRetry={refetch}
      >
        {pageResp && (
          <>
            <Table data={pageResp.data} columns={columns} rowKey={(c) => c.id} />
            <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
          </>
        )}
      </StateView>

      {fecharOpen && (
        <FecharMesModal
          onClose={() => setFecharOpen(false)}
          onDone={() => {
            setFecharOpen(false);
            refetch();
          }}
        />
      )}
      {pagar && (
        <PagarModal
          comissao={pagar}
          onClose={() => setPagar(null)}
          onDone={() => {
            setPagar(null);
            refetch();
          }}
        />
      )}
    </section>
  );
}

function FecharMesModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const now = new Date();
  // Default: mês anterior (que é o que normalmente se fecha)
  const dPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [mes, setMes] = useState(dPrev.getMonth() + 1);
  const [ano, setAno] = useState(dPrev.getFullYear());
  const [reprocessar, setReprocessar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/comissoes/fechar-mes', { mes, ano, reprocessar });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Fechar mês de comissões"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="fechar-mes-form"
            data-testid="fechar-mes-confirm"
            disabled={busy}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
          >
            {busy ? 'Fechando…' : 'Fechar mês'}
          </button>
        </>
      }
    >
      <form id="fechar-mes-form" onSubmit={submit}>
        <p className="text-muted text-[13px] mt-0">
          Agrega pedidos comissionáveis do período e cria/atualiza registros REP + GERENTE + SITE.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Mês" htmlFor="fm-mes" required>
            <Select id="fm-mes" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
              {MES_NOMES.map((n, i) => (
                <option key={i} value={i + 1}>
                  {n}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Ano" htmlFor="fm-ano" required>
            <Input
              id="fm-ano"
              type="number"
              min={2020}
              max={2100}
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
            />
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-[13px] mt-2">
          <input
            type="checkbox"
            data-testid="reprocessar-checkbox"
            checked={reprocessar}
            onChange={(e) => setReprocessar(e.target.checked)}
          />
          Reprocessar (sobrescreve fechamentos existentes)
        </label>
        {error && <p className="text-danger text-[13px] mt-2">{error}</p>}
      </form>
    </Dialog>
  );
}

function PagarModal({
  comissao,
  onClose,
  onDone,
}: {
  comissao: Comissao;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reciboUrl, setReciboUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (reciboUrl.trim()) payload.reciboUrl = reciboUrl.trim();
      await api.put(`/comissoes/${comissao.id}/pagar`, payload);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Marcar comissão como paga — ${MES_NOMES[comissao.mes - 1]}/${comissao.ano}`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="pagar-form"
            data-testid="pagar-confirm"
            disabled={busy}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
          >
            {busy ? 'Marcando…' : 'Marcar como pago'}
          </button>
        </>
      }
    >
      <form id="pagar-form" onSubmit={submit}>
        <p className="mt-0 text-[14px]">
          <strong>{comissao.representante?.nome}</strong> — {fmtBRL(comissao.totalComissao)}
        </p>
        <FormField
          label="URL do recibo (opcional)"
          htmlFor="pg-recibo"
          hint="Ex: link do comprovante no Storage / Drive"
        >
          <Input
            id="pg-recibo"
            type="url"
            data-testid="pagar-recibo-input"
            value={reciboUrl}
            onChange={(e) => setReciboUrl(e.target.value)}
            placeholder="https://…"
          />
        </FormField>
        {error && <p className="text-danger text-[13px]">{error}</p>}
      </form>
    </Dialog>
  );
}
