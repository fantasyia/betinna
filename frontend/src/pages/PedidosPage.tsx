import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  Download,
  FileText,
  FileSpreadsheet,
  File,
  ExternalLink,
  X as XIcon,
  Send,
  ArrowRight,
  Check,
  AlertCircle,
  ShoppingCart,
  Calendar,
  User,
  CreditCard,
  Receipt,
  Truck,
  CheckCircle2,
  CircleDashed,
  Hash,
  Pencil,
  XCircle,
  Plus,
} from 'lucide-react';
import { NovoPedidoDialog } from '@/components/NovoPedidoDialog';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { VendasTabs } from '@/components/VendasTabs';
import { StateView } from '@/components/StateView';
import { useToast } from '@/components/toast';
import { exportToCsv } from '@/lib/csv';
import { exportToXlsx } from '@/lib/xlsx';
import { exportToDocx } from '@/lib/docx';
import { exportToPdf } from '@/lib/pdf';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  formatMoeda as fmtBRL,
  formatMoedaCompacta as fmtBRLCompact,
  formatNumero,
} from '@/lib/masks';

/**
 * PedidosPage v2 — design system dark, timeline visual de status.
 *
 * - Toolbar com search + filtro status
 * - Tabela com numero/cliente/rep/total tabular + status badge semântico
 * - Click na row abre Drawer com:
 *   * Timeline visual do ciclo de vida (Rascunho → ... → Entregue)
 *   * Info grid (cliente, pagamento, subtotal, desconto, total)
 *   * Itens
 *   * Actions contextuais (Enviar OMIE, Avançar status, Cancelar)
 * - Cancel via Dialog separado
 */

type PedidoStatus =
  | 'RASCUNHO'
  | 'AGUARDANDO_APROVACAO'
  | 'ENVIADO_OMIE'
  | 'PAGO'
  | 'EM_SEPARACAO'
  | 'ENVIADO'
  | 'ENTREGUE'
  | 'CANCELADO';

interface Pedido {
  id: string;
  numero: string | number;
  total: number;
  status: PedidoStatus;
  cliente?: { id: string; nome: string };
  representante?: { id: string; nome: string };
  criadoEm: string;
  numeroOmie?: string | null;
  enviadoOmieEm?: string | null;
}

interface PedidoDetail extends Pedido {
  subtotal?: number;
  descontoTotal?: number;
  formaPagamento?: string;
  observacao?: string | null;
  itens?: Array<{
    id: string;
    produto?: { id: string; nome: string; sku?: string };
    quantidade: number;
    precoUnitario: number;
    desconto: number;
    total: number;
  }>;
  /** Datas de cada transição — opcionais (se backend expor). */
  enviadoEm?: string | null;
  entregueEm?: string | null;
  pagoEm?: string | null;
  separacaoEm?: string | null;
  canceladoEm?: string | null;
  cancelMotivo?: string | null;
}

// ─── Mapeamento de status ──────────────────────────────────────

const STATUS_LABEL: Record<PedidoStatus, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  ENVIADO_OMIE: 'Enviado ao OMIE',
  PAGO: 'Pago',
  EM_SEPARACAO: 'Em separação',
  ENVIADO: 'Enviado',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};

const STATUS_VARIANT: Record<
  PedidoStatus,
  'neutral' | 'warning' | 'info' | 'success' | 'primary' | 'danger'
> = {
  RASCUNHO: 'neutral',
  AGUARDANDO_APROVACAO: 'warning',
  ENVIADO_OMIE: 'info',
  PAGO: 'success',
  EM_SEPARACAO: 'primary',
  ENVIADO: 'info',
  ENTREGUE: 'success',
  CANCELADO: 'danger',
};

const STATUS_ICON: Record<PedidoStatus, typeof Pencil> = {
  RASCUNHO: Pencil,
  AGUARDANDO_APROVACAO: CircleDashed,
  ENVIADO_OMIE: Send,
  PAGO: CreditCard,
  EM_SEPARACAO: Receipt,
  ENVIADO: Truck,
  ENTREGUE: CheckCircle2,
  CANCELADO: XCircle,
};

/** Fluxo principal — usado pra timeline (Cancelado é estado terminal off-flow). */
const FLOW_STEPS: PedidoStatus[] = [
  'RASCUNHO',
  'ENVIADO_OMIE',
  'PAGO',
  'EM_SEPARACAO',
  'ENVIADO',
  'ENTREGUE',
];

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

// ─── Page principal ────────────────────────────────────────────

export default function PedidosPage() {
  const toast = useToast();
  const navigateTable = useNavigate();
  const role = useRole();
  // B2 — cancelar em massa é DIRECTOR/ADMIN (segue P6)
  const canCancelBulk = role === 'DIRECTOR' || role === 'ADMIN';
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  // Busca com debounce: o input responde na hora, requisição só ~300ms após parar.
  const buscaDebounced = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  // B2 — seleção múltipla pra ações em massa
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<'omie' | 'cancelar' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [periodo, setPeriodo] = useState<'todos' | '30d' | '90d' | '12m' | 'custom'>('todos');
  // Filtro custom de data (P5 — habilitado quando periodo = 'custom')
  const [dataInicioCustom, setDataInicioCustom] = useState('');
  const [dataFimCustom, setDataFimCustom] = useState('');
  // Filtro por cliente vindo da URL (ex: vindo da tab "Pedidos" do ClienteDetailPage)
  const clienteIdFilter = searchParams.get('clienteId') || '';

  // Abre drawer automaticamente quando vem com ?highlight=ID
  // (usado em navegações vindas de outras páginas — cliente tab pedidos,
  // duplicar/criar pedido).
  useEffect(() => {
    const highlight = searchParams.get('highlight');
    if (highlight && highlight !== selected) {
      setSelected(highlight);
      // Limpa o param da URL após abrir pra não reabrir em re-renders
      const next = new URLSearchParams(searchParams);
      next.delete('highlight');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Volta pra página 1 quando a busca (já debounced) muda.
  useEffect(() => {
    setPage(1);
  }, [buscaDebounced]);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (buscaDebounced.trim()) qs.set('search', buscaDebounced.trim());
    if (status) qs.set('status', status);
    if (clienteIdFilter) qs.set('clienteId', clienteIdFilter);
    if (periodo === 'custom') {
      if (dataInicioCustom) qs.set('dataInicio', new Date(dataInicioCustom).toISOString());
      if (dataFimCustom) {
        // dataFim deve incluir o dia inteiro (até 23:59:59.999)
        const fim = new Date(dataFimCustom);
        fim.setHours(23, 59, 59, 999);
        qs.set('dataFim', fim.toISOString());
      }
    } else if (periodo !== 'todos') {
      const dias = periodo === '30d' ? 30 : periodo === '90d' ? 90 : 365;
      const inicio = new Date();
      inicio.setDate(inicio.getDate() - dias);
      qs.set('dataInicio', inicio.toISOString());
    }
    return `/pedidos?${qs.toString()}`;
  }, [page, buscaDebounced, status, periodo, dataInicioCustom, dataFimCustom, clienteIdFilter]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Pedido>>(listPath);

  async function handleExport(formato: 'csv' | 'xlsx' | 'docx' | 'pdf') {
    setExporting(true);
    try {
      const query: Record<string, string> = {};
      if (search.trim()) query.search = search.trim();
      if (status) query.status = status;
      const filename = `pedidos-${new Date().toISOString().slice(0, 10)}.${formato}`;
      const columns = [
        { header: 'Número', value: (p: Pedido) => String(p.numero) },
        { header: 'Número OMIE', value: (p: Pedido) => p.numeroOmie ?? '' },
        { header: 'Cliente', value: (p: Pedido) => p.cliente?.nome ?? '' },
        { header: 'Representante', value: (p: Pedido) => p.representante?.nome ?? '' },
        {
          header: 'Total (R$)',
          value: (p: Pedido) =>
            formato === 'xlsx' ? p.total : p.total.toFixed(2).replace('.', ','),
        },
        { header: 'Status', value: (p: Pedido) => STATUS_LABEL[p.status] },
        { header: 'Criado em', value: (p: Pedido) => fmtDate(p.criadoEm) },
      ];
      let count = 0;
      if (formato === 'csv') {
        ({ count } = await exportToCsv<Pedido>({ endpoint: '/pedidos', query, filename, columns }));
      } else if (formato === 'xlsx') {
        ({ count } = await exportToXlsx<Pedido>({ endpoint: '/pedidos', query, filename, columns }));
      } else if (formato === 'docx') {
        ({ count } = await exportToDocx<Pedido>({
          endpoint: '/pedidos',
          query,
          filename,
          titulo: 'Lista de Pedidos',
          columns,
        }));
      } else {
        ({ count } = await exportToPdf<Pedido>({
          endpoint: '/pedidos',
          query,
          filename,
          titulo: 'Lista de Pedidos',
          columns,
        }));
      }
      toast.success(
        `${count} pedido${count === 1 ? '' : 's'} exportado${count === 1 ? '' : 's'}`,
        `${formato.toUpperCase()} baixado`,
      );
    } catch (err) {
      toast.error('Falha ao exportar', apiErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  const [creating, setCreating] = useState(false);
  const filtersActive =
    !!status ||
    !!search.trim() ||
    periodo !== 'todos' ||
    !!dataInicioCustom ||
    !!dataFimCustom;

  // ─── B2 — Seleção múltipla + ações em massa ──────────────────────────
  const rows = pageResp?.data ?? [];
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      // Se todos da página já selecionados, limpa; senão seleciona todos da página
      const allSelected = rows.length > 0 && rows.every((p) => prev.has(p.id));
      if (allSelected) return new Set();
      return new Set(rows.map((p) => p.id));
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function runBulk(
    tipo: 'omie' | 'cancelar',
    motivo?: string,
  ): Promise<void> {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(tipo);
    try {
      const path = tipo === 'omie' ? '/pedidos/bulk/enviar-omie' : '/pedidos/bulk/cancelar';
      const body = tipo === 'omie' ? { ids } : { ids, motivo };
      const res = await api.post<{ ok: number; falhas: Array<{ id: string; erro: string }> }>(
        path,
        body,
      );
      const acao = tipo === 'omie' ? 'enviados ao OMIE' : 'cancelados';
      if (res.falhas.length === 0) {
        toast.success(`${res.ok} pedido(s) ${acao}`);
      } else {
        toast.error(
          `${res.ok} ok, ${res.falhas.length} falhou`,
          res.falhas[0]?.erro ?? 'Ver detalhes',
        );
      }
      clearSelection();
      refetch();
    } catch (err) {
      toast.error('Falha na ação em massa', apiErrorMessage(err));
    } finally {
      setBulkBusy(null);
    }
  }

  const allPageSelected = rows.length > 0 && rows.every((p) => selectedIds.has(p.id));

  return (
    <PageLayout
      title="Pedidos"
      description={
        pageResp?.pagination
          ? `${formatNumero(pageResp.pagination.total)} pedidos no total`
          : undefined
      }
      actions={
        <>
          <ExportMenu exporting={exporting} onExport={handleExport} />
          <Button
            data-testid="pedido-new-btn"
            onClick={() => setCreating(true)}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Novo pedido
          </Button>
        </>
      }
    >
      <VendasTabs />
      {clienteIdFilter && (
        <div
          data-testid="pedidos-cliente-filter-banner"
          className="mb-3 px-3 py-2 rounded-md bg-info/10 border border-info/30 text-sm flex items-center gap-2"
        >
          <span className="flex-1 text-text">
            Filtrando pelos pedidos de um cliente específico.
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('clienteId');
              setSearchParams(next, { replace: true });
            }}
            leftIcon={<XIcon className="h-3 w-3" />}
          >
            Ver todos
          </Button>
        </div>
      )}

      <Card padding="none" className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
          <Input
            leftIcon={<Search />}
            placeholder="Cliente, número OMIE…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md flex-1"
          />
          <Select
            data-testid="filter-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos status</option>
            {(Object.keys(STATUS_LABEL) as PedidoStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            data-testid="filter-periodo"
            value={periodo}
            onChange={(e) => {
              const next = e.target.value as typeof periodo;
              setPeriodo(next);
              // Trocar de "custom" pra preset limpa as datas custom; vice-versa também
              if (next !== 'custom') {
                setDataInicioCustom('');
                setDataFimCustom('');
              }
              setPage(1);
            }}
          >
            <option value="todos">Todos os tempos</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
            <option value="12m">Últimos 12 meses</option>
            <option value="custom">Período custom…</option>
          </Select>
          {periodo === 'custom' && (
            <>
              <Input
                data-testid="filter-data-inicio"
                type="date"
                value={dataInicioCustom}
                onChange={(e) => {
                  setDataInicioCustom(e.target.value);
                  setPage(1);
                }}
                aria-label="Data início"
                className="w-[150px]"
              />
              <span className="text-xs text-muted">até</span>
              <Input
                data-testid="filter-data-fim"
                type="date"
                value={dataFimCustom}
                onChange={(e) => {
                  setDataFimCustom(e.target.value);
                  setPage(1);
                }}
                aria-label="Data fim"
                className="w-[150px]"
              />
            </>
          )}
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setStatus('');
                setPeriodo('todos');
                setDataInicioCustom('');
                setDataFimCustom('');
                setPage(1);
              }}
              leftIcon={<XIcon className="h-3 w-3" />}
            >
              Limpar
            </Button>
          )}
        </div>

        {/* B2 — Barra de ações em massa (aparece quando há seleção) */}
        {selectedIds.size > 0 && (
          <div
            className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border bg-primary/5"
            data-testid="bulk-actions-bar"
          >
            <span className="text-sm font-medium text-text">
              {selectedIds.size} selecionado{selectedIds.size > 1 ? 's' : ''}
            </span>
            <div className="flex-1" />
            <Button
              variant="secondary"
              size="sm"
              data-testid="bulk-enviar-omie"
              loading={bulkBusy === 'omie'}
              disabled={bulkBusy !== null}
              onClick={() => void runBulk('omie')}
              leftIcon={<Send className="h-3.5 w-3.5" />}
            >
              Enviar ao OMIE
            </Button>
            {canCancelBulk && (
              <Button
                variant="danger"
                size="sm"
                data-testid="bulk-cancelar"
                loading={bulkBusy === 'cancelar'}
                disabled={bulkBusy !== null}
                onClick={() => {
                  if (
                    window.confirm(
                      `Cancelar ${selectedIds.size} pedido(s)? Esta ação não pode ser desfeita.`,
                    )
                  ) {
                    void runBulk('cancelar');
                  }
                }}
                leftIcon={<XCircle className="h-3.5 w-3.5" />}
              >
                Cancelar
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              leftIcon={<XIcon className="h-3 w-3" />}
            >
              Limpar seleção
            </Button>
          </div>
        )}

        <StateView loading={loading} error={error} onRetry={refetch}>
          {pageResp && pageResp.data.length === 0 && (
            <EmptyState
              icon={<ShoppingCart />}
              title="Nenhum pedido encontrado"
              description={
                filtersActive
                  ? 'Tente ajustar os filtros pra encontrar o que procura.'
                  : 'Comece criando o primeiro pedido — você pode selecionar o cliente no dialog.'
              }
              action={
                filtersActive ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch('');
                      setStatus('');
                      setPeriodo('todos');
                      setPage(1);
                    }}
                    leftIcon={<XIcon className="h-3.5 w-3.5" />}
                  >
                    Limpar filtros
                  </Button>
                ) : (
                  <Button
                    onClick={() => setCreating(true)}
                    leftIcon={<Plus className="h-3.5 w-3.5" />}
                  >
                    Criar primeiro pedido
                  </Button>
                )
              }
              className="m-6 border-0"
            />
          )}
          {pageResp && pageResp.data.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-bg-alt">
                      <th className="w-10 px-3 py-2.5 text-left">
                        <input
                          type="checkbox"
                          data-testid="bulk-select-all"
                          checked={allPageSelected}
                          onChange={toggleSelectAll}
                          aria-label="Selecionar todos"
                          className="cursor-pointer"
                        />
                      </th>
                      <Th>Pedido</Th>
                      <Th>Cliente</Th>
                      <Th>Representante</Th>
                      <Th align="right">Total</Th>
                      <Th>Status</Th>
                      <Th>Data</Th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageResp.data.map((p) => {
                      const isSelected = p.id === selected;
                      const StatusIcon = STATUS_ICON[p.status];
                      return (
                        <tr
                          key={p.id}
                          className={cn(
                            'border-b border-border last:border-b-0 cursor-pointer transition-colors',
                            isSelected || selectedIds.has(p.id)
                              ? 'bg-surface-hover'
                              : 'hover:bg-surface-hover/60',
                          )}
                          onClick={() => setSelected(p.id)}
                          data-testid={`pedido-row-${p.id}`}
                        >
                          <td
                            className="w-10 px-3 py-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              data-testid={`bulk-select-${p.id}`}
                              checked={selectedIds.has(p.id)}
                              onChange={() => toggleSelect(p.id)}
                              aria-label={`Selecionar pedido ${p.numero}`}
                              className="cursor-pointer"
                            />
                          </td>
                          <Td>
                            <div className="flex flex-col min-w-0">
                              <strong className="text-sm text-text tabular font-semibold">
                                #{p.numero}
                              </strong>
                              {p.numeroOmie && (
                                <span className="text-[11px] text-muted tabular">
                                  OMIE {p.numeroOmie}
                                </span>
                              )}
                            </div>
                          </Td>
                          <Td>
                            {p.cliente ? (
                              <div className="flex items-center gap-2 min-w-0">
                                <Avatar name={p.cliente.nome} size="sm" />
                                <span className="text-sm text-text truncate">
                                  {p.cliente.nome}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-light italic text-sm">—</span>
                            )}
                          </Td>
                          <Td>
                            {p.representante ? (
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Avatar name={p.representante.nome} size="xs" />
                                <span className="text-sm text-text-subtle truncate">
                                  {p.representante.nome}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-light italic text-sm">—</span>
                            )}
                          </Td>
                          <Td align="right">
                            <span className="text-sm font-semibold text-text tabular">
                              {fmtBRL(p.total)}
                            </span>
                          </Td>
                          <Td>
                            <Badge
                              variant={STATUS_VARIANT[p.status]}
                              className="inline-flex items-center gap-1"
                            >
                              <StatusIcon className="h-2.5 w-2.5" />
                              {STATUS_LABEL[p.status]}
                            </Badge>
                          </Td>
                          <Td>
                            <span className="text-sm text-text-subtle tabular">
                              {fmtDate(p.criadoEm)}
                            </span>
                          </Td>
                          <Td
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateTable(`/pedidos/${p.id}`);
                            }}
                          >
                            <button
                              type="button"
                              aria-label="Abrir página do pedido"
                              data-testid={`pedido-row-open-${p.id}`}
                              className="p-1 -m-1 rounded text-muted hover:text-primary hover:bg-surface-hover transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {pageResp.pagination.totalPages > 1 && (
                <PaginationBar
                  current={pageResp.pagination.page}
                  total={pageResp.pagination.totalPages}
                  totalItems={pageResp.pagination.total}
                  onChange={setPage}
                />
              )}
            </>
          )}
        </StateView>
      </Card>

      {selected && (
        <PedidoDetailDrawer
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            refetch();
          }}
        />
      )}

      <NovoPedidoDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(pedidoId) => {
          setCreating(false);
          refetch();
          setSelected(pedidoId);
        }}
      />
    </PageLayout>
  );
}

// ─── Helpers locais ────────────────────────────────────────────

function Th({ children, align }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  onClick,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <td
      onClick={onClick}
      className={cn('px-4 py-2.5 align-middle', align === 'right' ? 'text-right' : 'text-left')}
    >
      {children}
    </td>
  );
}

function PaginationBar({
  current,
  total,
  totalItems,
  onChange,
}: {
  current: number;
  total: number;
  totalItems: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-bg-alt">
      <span className="text-xs text-muted tabular">
        Página {current} de {total} · {formatNumero(totalItems)} no total
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={current <= 1} onClick={() => onChange(current - 1)}>
          Anterior
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={current >= total}
          onClick={() => onChange(current + 1)}
        >
          Próxima
        </Button>
      </div>
    </div>
  );
}

// ─── Export menu ───────────────────────────────────────────────

function ExportMenu({
  exporting,
  onExport,
}: {
  exporting: boolean;
  onExport: (f: 'csv' | 'xlsx' | 'docx' | 'pdf') => void;
}) {
  const [open, setOpen] = useState(false);
  if (exporting) {
    return (
      <Button variant="secondary" loading>
        Exportando…
      </Button>
    );
  }
  return (
    <div className="relative">
      <Button
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        leftIcon={<Download className="h-3.5 w-3.5" />}
        data-testid="pedido-export-btn"
      >
        Exportar
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full mt-1 z-40 min-w-[160px] bg-surface-elevated border border-border-strong rounded-md shadow-lg flex flex-col p-1 animate-fade-in">
            <ExportItem icon={<FileText className="h-3.5 w-3.5" />} label="CSV" onClick={() => { setOpen(false); onExport('csv'); }} />
            <ExportItem icon={<FileSpreadsheet className="h-3.5 w-3.5" />} label="Excel (XLSX)" testId="pedido-export-xlsx-btn" onClick={() => { setOpen(false); onExport('xlsx'); }} />
            <ExportItem icon={<File className="h-3.5 w-3.5" />} label="Word (DOCX)" testId="pedido-export-docx-btn" onClick={() => { setOpen(false); onExport('docx'); }} />
            <ExportItem icon={<File className="h-3.5 w-3.5" />} label="PDF" testId="pedido-export-pdf-btn" onClick={() => { setOpen(false); onExport('pdf'); }} />
          </div>
        </>
      )}
    </div>
  );
}

function ExportItem({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-1.5 text-left text-sm rounded text-text hover:bg-surface-hover transition-colors"
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}

// ─── Detail drawer ─────────────────────────────────────────────

function PedidoDetailDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const role = useRole();
  // P6 — cancelar pedido é DIRECTOR/ADMIN only.
  // REP/GERENTE pode SOLICITAR cancelamento (P6.2) — diretor decide depois.
  const canCancel = role === 'DIRECTOR' || role === 'ADMIN';
  const canRequestCancel = role === 'REP' || role === 'GERENTE';
  const { data, loading, error, refetch } = useApiQuery<PedidoDetail>(`/pedidos/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelMotivo, setCancelMotivo] = useState('');
  const [requestCancelOpen, setRequestCancelOpen] = useState(false);
  const [requestCancelMotivo, setRequestCancelMotivo] = useState('');

  async function callAction(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setActionError(apiErrorMessage(err));
      refetch();
    } finally {
      setBusy(null);
    }
  }

  const enviarOmie = () => callAction('enviar', () => api.post(`/pedidos/${id}/enviar-omie`));
  const avancar = () => callAction('avancar', () => api.post(`/pedidos/${id}/avancar-status`));
  const doCancel = () =>
    callAction('cancelar', () =>
      api.post(
        `/pedidos/${id}/cancelar`,
        cancelMotivo.trim() ? { motivo: cancelMotivo.trim() } : {},
      ),
    );
  const doRequestCancel = () =>
    callAction('solicitar-cancel', () =>
      api.post(`/pedidos/${id}/solicitar-cancelamento`, {
        motivo: requestCancelMotivo.trim(),
      }),
    );

  return (
    <Drawer
      open
      onClose={onClose}
      title={data ? `Pedido #${data.numero}` : 'Pedido'}
      description={data?.numeroOmie ? `OMIE ${data.numeroOmie}` : undefined}
      width="lg"
      footer={
        data && (
          <>
            <Button
              variant="secondary"
              size="sm"
              data-testid="pedido-abrir-pagina"
              onClick={() => navigate(`/pedidos/${id}`)}
              leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
            >
              Abrir página
            </Button>
            <div className="flex-1" />
            {data.status === 'RASCUNHO' && (
              <Button
                data-testid="pedido-enviar-omie"
                onClick={enviarOmie}
                loading={busy === 'enviar'}
                leftIcon={<Send className="h-3.5 w-3.5" />}
              >
                Enviar pro OMIE
              </Button>
            )}
            {['ENVIADO_OMIE', 'PAGO', 'EM_SEPARACAO', 'ENVIADO'].includes(data.status) && (
              <Button
                data-testid="pedido-avancar"
                onClick={avancar}
                loading={busy === 'avancar'}
                rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
              >
                Avançar status
              </Button>
            )}
            {/* P6 — botão Cancelar direto só pra DIRECTOR/ADMIN */}
            {canCancel && data.status !== 'CANCELADO' && data.status !== 'ENTREGUE' && (
              <Button
                variant="danger"
                size="sm"
                data-testid="pedido-cancelar"
                onClick={() => setCancelOpen(true)}
                leftIcon={<XCircle className="h-3.5 w-3.5" />}
              >
                Cancelar
              </Button>
            )}
            {/* P6.2 — REP/GERENTE solicita cancelamento (diretor decide depois) */}
            {canRequestCancel && data.status !== 'CANCELADO' && data.status !== 'ENTREGUE' && (
              <Button
                variant="secondary"
                size="sm"
                data-testid="pedido-solicitar-cancelar"
                onClick={() => setRequestCancelOpen(true)}
                leftIcon={<XCircle className="h-3.5 w-3.5" />}
              >
                Solicitar cancelamento
              </Button>
            )}
          </>
        )
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div className="flex flex-col gap-5">
            {/* Header card com total + status */}
            <Card variant="outline" padding="md" className="bg-bg-alt">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted mb-1">
                    Total do pedido
                  </div>
                  <div className="text-3xl font-bold text-text tracking-tight tabular">
                    {fmtBRL(data.total)}
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <Badge variant={STATUS_VARIANT[data.status]}>
                      {STATUS_LABEL[data.status]}
                    </Badge>
                    {data.formaPagamento && (
                      <Badge variant="outline" size="sm">
                        {data.formaPagamento}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {/* Timeline */}
            {data.status !== 'CANCELADO' && <StatusTimeline pedido={data} />}
            {data.status === 'CANCELADO' && <CanceledNote pedido={data} />}

            {/* Info grid */}
            <section>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                Resumo
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <InfoCell
                  icon={<User />}
                  label="Cliente"
                  value={data.cliente?.nome}
                  avatar={data.cliente?.nome}
                />
                <InfoCell
                  icon={<User />}
                  label="Representante"
                  value={data.representante?.nome}
                  avatar={data.representante?.nome}
                />
                <InfoCell
                  icon={<Calendar />}
                  label="Criado em"
                  value={fmtDateTime(data.criadoEm)}
                />
                {data.numeroOmie && (
                  <InfoCell icon={<Hash />} label="OMIE" value={data.numeroOmie} mono />
                )}
                <InfoCell
                  icon={<Receipt />}
                  label="Subtotal"
                  value={data.subtotal !== undefined ? fmtBRL(data.subtotal) : '—'}
                  mono
                />
                <InfoCell
                  icon={<Receipt />}
                  label="Desconto"
                  value={data.descontoTotal !== undefined ? fmtBRL(data.descontoTotal) : '—'}
                  mono
                />
              </div>
            </section>

            {/* Itens */}
            {data.itens && data.itens.length > 0 && (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                  Itens ({data.itens.length})
                </h4>
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-bg-alt">
                        <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
                          Produto
                        </th>
                        <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
                          Qt
                        </th>
                        <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
                          Unit
                        </th>
                        <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.itens.map((it) => (
                        <tr key={it.id} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-2">
                            <div className="text-sm text-text">{it.produto?.nome ?? '—'}</div>
                            {it.produto?.sku && (
                              <div className="text-[10px] text-muted tabular">
                                SKU {it.produto.sku}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-sm text-text tabular">
                            {it.quantidade}
                          </td>
                          <td className="px-3 py-2 text-right text-sm text-text-subtle tabular">
                            {fmtBRLCompact(it.precoUnitario)}
                          </td>
                          <td className="px-3 py-2 text-right text-sm font-semibold text-text tabular">
                            {fmtBRL(it.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {data.observacao && (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                  Observação
                </h4>
                <p className="text-sm text-text-subtle leading-relaxed whitespace-pre-wrap m-0">
                  {data.observacao}
                </p>
              </section>
            )}

            {actionError && (
              <div
                data-testid="action-error"
                className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {actionError}
              </div>
            )}
          </div>
        )}
      </StateView>

      {/* Cancel dialog */}
      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancelar pedido?"
        description="Essa ação não pode ser desfeita."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              data-testid="pedido-confirmar-cancelar"
              loading={busy === 'cancelar'}
              onClick={() => {
                setCancelOpen(false);
                void doCancel();
              }}
              leftIcon={<XCircle className="h-3.5 w-3.5" />}
            >
              Confirmar cancelamento
            </Button>
          </>
        }
      >
        <Field label="Motivo" hint="Opcional, mas recomendado pro histórico">
          <Textarea
            value={cancelMotivo}
            onChange={(e) => setCancelMotivo(e.target.value)}
            placeholder="Ex: cliente desistiu, estoque indisponível, troca de SKU…"
            rows={3}
          />
        </Field>
      </Dialog>

      {/* P6.2 — Solicitar cancelamento dialog (rep/gerente) */}
      <Dialog
        open={requestCancelOpen}
        onClose={() => setRequestCancelOpen(false)}
        title="Solicitar cancelamento"
        description="O diretor vai revisar e aprovar ou rejeitar. O pedido só é cancelado após aprovação."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRequestCancelOpen(false)}>
              Voltar
            </Button>
            <Button
              data-testid="pedido-confirmar-solicitar-cancelar"
              loading={busy === 'solicitar-cancel'}
              disabled={requestCancelMotivo.trim().length < 5}
              onClick={() => {
                setRequestCancelOpen(false);
                const motivo = requestCancelMotivo;
                setRequestCancelMotivo('');
                void doRequestCancel().then(() => {
                  // Restaura motivo se houve erro pra o usuário poder ajustar
                  if (actionError) setRequestCancelMotivo(motivo);
                });
              }}
              leftIcon={<XCircle className="h-3.5 w-3.5" />}
            >
              Enviar solicitação
            </Button>
          </>
        }
      >
        <Field
          label="Motivo"
          required
          hint="Mínimo 5 caracteres — diga ao diretor por que o pedido deve ser cancelado"
        >
          <Textarea
            value={requestCancelMotivo}
            onChange={(e) => setRequestCancelMotivo(e.target.value)}
            placeholder="Ex: cliente cancelou compra por mudança de fornecedor; produto indisponível por 30 dias..."
            rows={4}
            maxLength={1000}
            data-testid="solicitar-cancelar-motivo"
          />
        </Field>
      </Dialog>
    </Drawer>
  );
}

// ─── Status timeline ───────────────────────────────────────────

function StatusTimeline({ pedido }: { pedido: PedidoDetail }) {
  const currentIdx = FLOW_STEPS.indexOf(pedido.status);
  // AGUARDANDO_APROVACAO fica entre RASCUNHO e ENVIADO_OMIE — branca da linha principal
  const isAwaiting = pedido.status === 'AGUARDANDO_APROVACAO';

  return (
    <section>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-3">
        Ciclo de vida
      </h4>
      {isAwaiting && (
        <div className="mb-3 px-3 py-2 rounded-md bg-warning/10 border border-warning/30 text-warning text-sm flex items-center gap-2">
          <CircleDashed className="h-4 w-4 shrink-0" />
          Aguardando aprovação de desconto pra ir pro OMIE.
        </div>
      )}
      <ol className="flex flex-col gap-0">
        {FLOW_STEPS.map((step, idx) => {
          const Icon = STATUS_ICON[step];
          const isDone = currentIdx > idx;
          const isCurrent = currentIdx === idx;
          const isFuture = currentIdx < idx;
          const dateField = stepDate(pedido, step);

          return (
            <li key={step} className="flex items-start gap-3 group relative">
              {/* Vertical line */}
              {idx < FLOW_STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-[15px] top-8 bottom-0 w-px',
                    isDone ? 'bg-success' : 'bg-border',
                  )}
                />
              )}
              {/* Icon */}
              <div
                className={cn(
                  'relative flex h-8 w-8 items-center justify-center rounded-full border-2 shrink-0 z-10',
                  isDone && 'bg-success border-success text-bg',
                  isCurrent && 'bg-primary border-primary text-primary-contrast shadow-ring',
                  isFuture && 'bg-bg border-border text-muted-light',
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Icon className="h-3.5 w-3.5" />}
              </div>
              {/* Content */}
              <div className={cn('flex-1 pb-5', idx === FLOW_STEPS.length - 1 && 'pb-0')}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      isCurrent && 'text-text',
                      isDone && 'text-text-subtle',
                      isFuture && 'text-muted',
                    )}
                  >
                    {STATUS_LABEL[step]}
                  </span>
                  {isCurrent && (
                    <Badge variant="primary" size="sm">
                      atual
                    </Badge>
                  )}
                </div>
                {dateField && (
                  <span className="text-[11px] text-muted tabular">{fmtDateTime(dateField)}</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CanceledNote({ pedido }: { pedido: PedidoDetail }) {
  return (
    <div className="px-4 py-3 rounded-md bg-danger/10 border border-danger/30">
      <div className="flex items-center gap-2 mb-1">
        <XCircle className="h-4 w-4 text-danger" />
        <strong className="text-sm text-danger">Pedido cancelado</strong>
        {pedido.canceladoEm && (
          <span className="text-[11px] text-muted tabular">{fmtDateTime(pedido.canceladoEm)}</span>
        )}
      </div>
      {pedido.cancelMotivo && (
        <p className="text-sm text-text-subtle m-0">{pedido.cancelMotivo}</p>
      )}
    </div>
  );
}

function stepDate(p: PedidoDetail, step: PedidoStatus): string | null | undefined {
  switch (step) {
    case 'RASCUNHO':
      return p.criadoEm;
    case 'ENVIADO_OMIE':
      return p.enviadoOmieEm;
    case 'PAGO':
      return p.pagoEm;
    case 'EM_SEPARACAO':
      return p.separacaoEm;
    case 'ENVIADO':
      return p.enviadoEm;
    case 'ENTREGUE':
      return p.entregueEm;
    default:
      return null;
  }
}

// ─── InfoCell ─────────────────────────────────────────────────

function InfoCell({
  icon,
  label,
  value,
  avatar,
  mono,
}: {
  icon: ReactNode;
  label: string;
  value?: string | null;
  avatar?: string;
  mono?: boolean;
}) {
  if (!value || value === '—') {
    return (
      <div className="rounded-md border border-border bg-bg-alt px-3 py-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted mb-1 [&>svg]:h-3 [&>svg]:w-3">
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-sm text-muted-light italic">—</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-bg-alt px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted mb-1 [&>svg]:h-3 [&>svg]:w-3">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {avatar && <Avatar name={avatar} size="xs" />}
        <span className={cn('text-sm text-text truncate', mono && 'tabular')}>{value}</span>
      </div>
    </div>
  );
}
