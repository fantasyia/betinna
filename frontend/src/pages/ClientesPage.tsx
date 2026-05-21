import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  Download,
  FileText,
  FileSpreadsheet,
  File,
  X,
  UserCog,
  Trash2,
  ExternalLink,
  MapPin,
  Mail,
  Phone,
  Hash,
  Building2,
  AlertCircle,
  Receipt,
} from 'lucide-react';
import { NovoPedidoDialog, type ClienteOpt } from '@/components/NovoPedidoDialog';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { usePermission } from '@/hooks/usePermission';
import { PageLayout, useIsMobile } from '@/components/PageLayout';
import { CrmTabs } from '@/components/CrmTabs';
import { StateView } from '@/components/StateView';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { useToast } from '@/components/toast';
import { isValidCNPJ, maskCEP, maskCNPJ, maskTelefone, normalizeUF, stripMask } from '@/lib/masks';
import { exportToCsv } from '@/lib/csv';
import { exportToXlsx } from '@/lib/xlsx';
import { exportToDocx } from '@/lib/docx';
import { exportToPdf } from '@/lib/pdf';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
} from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * ClientesPage v2 — design system dark, list + detail panel.
 *
 * Layout:
 *  - Toolbar: search + filtros + bulk bar contextual
 *  - Tabela compacta com avatares, badges semânticos
 *  - Click na row abre <Drawer> com detalhes do cliente (não navega)
 *  - "Abrir página" no drawer → /clientes/:id
 */

interface RepOpt {
  id: string;
  nome: string;
  email?: string;
}

type ClienteStatus = 'ATIVO' | 'NOVO' | 'PROSPECT' | 'RISCO' | 'CRITICO' | 'INATIVO';
type OmieStatus = 'ATIVO' | 'BLOQUEADO';

interface Cliente {
  id: string;
  nome: string;
  cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  segmento?: string | null;
  status: ClienteStatus;
  omieStatus: OmieStatus;
  score: number;
  representante?: { id: string; nome: string } | null;
  tags?: Array<{ id: string; nome: string; cor?: string | null }>;
  criadoEm?: string;
  _count?: { pedidos?: number; propostas?: number; ocorrencias?: number; amostras?: number };
}

interface Lista {
  id: string;
  nome: string;
  descricao?: string;
}

// Mapping status → Badge variant (semântico, sem hex)
const STATUS_VARIANT: Record<ClienteStatus, 'success' | 'info' | 'primary' | 'warning' | 'danger' | 'neutral'> = {
  ATIVO: 'success',
  NOVO: 'info',
  PROSPECT: 'primary',
  RISCO: 'warning',
  CRITICO: 'danger',
  INATIVO: 'neutral',
};

const STATUS_LABEL: Record<ClienteStatus, string> = {
  ATIVO: 'Ativo',
  NOVO: 'Novo',
  PROSPECT: 'Prospect',
  RISCO: 'Em risco',
  CRITICO: 'Crítico',
  INATIVO: 'Inativo',
};

const OMIE_VARIANT: Record<OmieStatus, 'success' | 'danger'> = {
  ATIVO: 'success',
  BLOQUEADO: 'danger',
};

export default function ClientesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const canEdit = usePermission('clientes.edit');
  const canBulk = usePermission('clientes.bulkAssign');
  const isMobile = useIsMobile();

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ page: number; total: number } | null>(null);

  // Filtros / paginação
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [omie, setOmie] = useState<string>('');
  const [lista, setLista] = useState<string>('');

  const listPath = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '20');
    if (search.trim()) qs.set('search', search.trim());
    if (status) qs.set('status', status);
    if (omie) qs.set('omieStatus', omie);
    if (lista) qs.set('lista', lista);
    return `/clientes?${qs.toString()}`;
  }, [page, search, status, omie, lista]);

  const {
    data: page$,
    loading,
    error,
    refetch,
  } = useApiQuery<PaginatedResponse<Cliente>>(listPath);
  const { data: listasMeta } = useApiQuery<Lista[]>('/clientes/listas');

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [novoPedidoFor, setNovoPedidoFor] = useState<ClienteOpt | null>(null);

  const onSaved = () => {
    setCreating(false);
    setEditingId(null);
    refetch();
  };

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const currentPageIds = page$?.data.map((c) => c.id) ?? [];
  const allCurrentSelected =
    currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.has(id));

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllCurrent() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allCurrentSelected) for (const id of currentPageIds) next.delete(id);
      else for (const id of currentPageIds) next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleExport(formato: 'csv' | 'xlsx' | 'docx' | 'pdf') {
    setExporting(true);
    setExportProgress(null);
    try {
      const query: Record<string, string> = {};
      if (search.trim()) query.search = search.trim();
      if (status) query.status = status;
      if (omie) query.omieStatus = omie;
      if (lista) query.lista = lista;
      const data = new Date().toISOString().slice(0, 10);
      const columns = [
        { header: 'Nome', value: (c: Cliente) => c.nome },
        { header: 'CNPJ', value: (c: Cliente) => c.cnpj ?? '' },
        { header: 'E-mail', value: (c: Cliente) => c.email ?? '' },
        { header: 'Telefone', value: (c: Cliente) => c.telefone ?? '' },
        { header: 'Cidade', value: (c: Cliente) => c.cidade ?? '' },
        { header: 'UF', value: (c: Cliente) => c.uf ?? '' },
        { header: 'Segmento', value: (c: Cliente) => c.segmento ?? '' },
        { header: 'Status', value: (c: Cliente) => c.status },
        { header: 'OMIE', value: (c: Cliente) => c.omieStatus },
        { header: 'Score', value: (c: Cliente) => c.score },
        { header: 'Representante', value: (c: Cliente) => c.representante?.nome ?? '' },
      ];
      const filename = `clientes-${data}.${formato}`;
      let count = 0;
      if (formato === 'csv') {
        ({ count } = await exportToCsv<Cliente>({
          endpoint: '/clientes',
          query,
          filename,
          onProgress: (p, t) => setExportProgress({ page: p, total: t }),
          columns,
        }));
      } else if (formato === 'xlsx') {
        ({ count } = await exportToXlsx<Cliente>({
          endpoint: '/clientes',
          query,
          filename,
          onProgress: (p, t) => setExportProgress({ page: p, total: t }),
          columns,
        }));
      } else if (formato === 'docx') {
        ({ count } = await exportToDocx<Cliente>({
          endpoint: '/clientes',
          query,
          filename,
          titulo: 'Lista de Clientes',
          onProgress: (p, t) => setExportProgress({ page: p, total: t }),
          columns,
        }));
      } else {
        ({ count } = await exportToPdf<Cliente>({
          endpoint: '/clientes',
          query,
          filename,
          titulo: 'Lista de Clientes',
          columns,
        }));
      }
      toast.success(
        `${count} cliente${count === 1 ? '' : 's'} exportado${count === 1 ? '' : 's'}`,
        `${formato.toUpperCase()} baixado`,
      );
    } catch (err) {
      toast.error('Falha ao exportar', err instanceof ApiError ? err.message : undefined);
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }

  const filtersActive = status || omie || lista || search.trim();

  return (
    <PageLayout
      title="Clientes"
      description={page$?.pagination ? `${page$.pagination.total.toLocaleString('pt-BR')} clientes no total` : undefined}
      actions={
        <>
          <ExportMenu
            exporting={exporting}
            progress={exportProgress}
            onExport={handleExport}
          />
          {canEdit && (
            <Button
              data-testid="cliente-new-btn"
              onClick={() => setCreating(true)}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              Novo cliente
            </Button>
          )}
        </>
      }
    >
      <CrmTabs />
      <Card padding="none" className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 px-4 py-3 border-b border-border">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              leftIcon={<Search />}
              placeholder="Buscar por nome, CNPJ, e-mail…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="max-w-md flex-1"
            />
            <Select
              data-testid="filter-status"
              size="md"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos status</option>
              {(Object.keys(STATUS_LABEL) as ClienteStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            <Select
              data-testid="filter-omie"
              size="md"
              value={omie}
              onChange={(e) => {
                setOmie(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos OMIE</option>
              <option value="ATIVO">Ativos OMIE</option>
              <option value="BLOQUEADO">Bloqueados OMIE</option>
            </Select>
            <Select
              data-testid="filter-lista"
              size="md"
              value={lista}
              onChange={(e) => {
                setLista(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Listas dinâmicas</option>
              {listasMeta?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </Select>
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setStatus('');
                  setOmie('');
                  setLista('');
                  setPage(1);
                }}
                leftIcon={<X className="h-3 w-3" />}
              >
                Limpar filtros
              </Button>
            )}
          </div>
        </div>

        {/* Lista */}
        <StateView loading={loading} error={error} onRetry={refetch}>
          {page$ && page$.data.length === 0 && (
            <EmptyState
              icon={<Building2 />}
              title="Nenhum cliente encontrado"
              description={
                filtersActive
                  ? 'Tente ajustar os filtros ou limpar a busca.'
                  : 'Cadastre o primeiro cliente ou importe via OMIE.'
              }
              action={
                canEdit && !filtersActive ? (
                  <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                    Novo cliente
                  </Button>
                ) : undefined
              }
              className="m-6 border-0"
            />
          )}
          {page$ && page$.data.length > 0 && (
            <>
              {/* Tabela / cards */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-bg-alt">
                      {canBulk && (
                        <th className="w-10 px-4 py-2.5">
                          <Checkbox
                            data-testid="bulk-select-all"
                            checked={allCurrentSelected}
                            onChange={toggleAllCurrent}
                            aria-label="Selecionar todos da página"
                          />
                        </th>
                      )}
                      <Th>Cliente</Th>
                      <Th>Local</Th>
                      <Th>Representante</Th>
                      <Th>Status</Th>
                      <Th>OMIE</Th>
                      <Th align="right">Score</Th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {page$.data.map((c) => {
                      const selected = selectedIds.has(c.id);
                      const isDetail = c.id === detailId;
                      return (
                        <tr
                          key={c.id}
                          className={cn(
                            'border-b border-border last:border-b-0 cursor-pointer',
                            'transition-colors duration-100',
                            isDetail ? 'bg-surface-hover' : 'hover:bg-surface-hover/60',
                          )}
                          onClick={() => setDetailId(c.id)}
                          data-testid={`cliente-row-${c.id}`}
                        >
                          {canBulk && (
                            <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                data-testid={`bulk-select-${c.id}`}
                                checked={selected}
                                onChange={() => toggleOne(c.id)}
                                aria-label={`Selecionar ${c.nome}`}
                              />
                            </td>
                          )}
                          <Td>
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Avatar name={c.nome} size="sm" />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-text truncate">
                                  {c.nome}
                                </div>
                                {c.cnpj && (
                                  <div className="text-[11px] text-muted tabular">{c.cnpj}</div>
                                )}
                              </div>
                            </div>
                          </Td>
                          <Td>
                            {c.cidade ? (
                              <span className="text-sm text-text-subtle">
                                {c.cidade}
                                {c.uf && <span className="text-muted">/{c.uf}</span>}
                              </span>
                            ) : (
                              <span className="text-muted text-sm">—</span>
                            )}
                          </Td>
                          <Td>
                            {c.representante ? (
                              <div className="flex items-center gap-2 min-w-0">
                                <Avatar name={c.representante.nome} size="xs" />
                                <span className="text-sm text-text truncate">
                                  {c.representante.nome}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted text-xs italic">sem rep</span>
                            )}
                          </Td>
                          <Td>
                            <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                          </Td>
                          <Td>
                            <Badge variant={OMIE_VARIANT[c.omieStatus]} size="sm">
                              {c.omieStatus === 'ATIVO' ? 'Ativo' : 'Bloqueado'}
                            </Badge>
                          </Td>
                          <Td align="right">
                            <ScorePill score={c.score} />
                          </Td>
                          <Td onClick={(e) => e.stopPropagation()}>
                            <IconButton
                              aria-label="Abrir página completa"
                              variant="ghost"
                              size="sm"
                              icon={<ExternalLink />}
                              onClick={() => navigate(`/clientes/${c.id}`)}
                              data-testid={`cliente-open-${c.id}`}
                            />
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {page$.pagination.totalPages > 1 && (
                <PaginationBar
                  current={page$.pagination.page}
                  total={page$.pagination.totalPages}
                  totalItems={page$.pagination.total}
                  onChange={setPage}
                />
              )}
            </>
          )}
        </StateView>
      </Card>

      {/* Floating bulk action bar */}
      {canBulk && selectedIds.size > 0 && (
        <div
          data-testid="bulk-bar"
          className={cn(
            'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
            'flex items-center gap-3 px-3 py-2',
            'bg-surface-elevated border border-border-strong rounded-full shadow-xl',
            'animate-slide-up',
          )}
        >
          <span data-testid="bulk-count" className="text-sm text-text pl-2">
            <strong className="text-primary">{selectedIds.size}</strong>{' '}
            cliente{selectedIds.size === 1 ? '' : 's'} selecionado
            {selectedIds.size === 1 ? '' : 's'}
          </span>
          <Button
            size="sm"
            data-testid="bulk-assign-open"
            onClick={() => setBulkOpen(true)}
            leftIcon={<UserCog className="h-3.5 w-3.5" />}
          >
            Atribuir rep
          </Button>
          <IconButton
            aria-label="Limpar seleção"
            variant="ghost"
            size="sm"
            icon={<X />}
            onClick={clearSelection}
            data-testid="bulk-clear"
          />
        </div>
      )}

      {/* Detail drawer */}
      {detailId && (
        <ClienteDetailDrawer
          id={detailId}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setEditingId(detailId);
            setDetailId(null);
          }}
          onDeleted={() => {
            setDetailId(null);
            refetch();
          }}
          onCreatePedido={(c) => {
            setNovoPedidoFor(c);
            setDetailId(null);
          }}
          isMobile={isMobile}
        />
      )}

      <NovoPedidoDialog
        open={novoPedidoFor !== null}
        clientePreSelecionado={novoPedidoFor}
        onClose={() => setNovoPedidoFor(null)}
        onCreated={(pedidoId) => {
          setNovoPedidoFor(null);
          navigate(`/pedidos?highlight=${pedidoId}`);
        }}
      />

      {creating && (
        <ClienteFormModal open cliente={null} onClose={() => setCreating(false)} onSaved={onSaved} />
      )}

      {editingId && (
        <EditingFormLoader id={editingId} onClose={() => setEditingId(null)} onSaved={onSaved} />
      )}

      {bulkOpen && (
        <BulkAssignModal
          clienteIds={Array.from(selectedIds)}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            clearSelection();
            refetch();
          }}
        />
      )}
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
      className={cn(
        'px-4 py-2.5 align-middle',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </td>
  );
}

function ScorePill({ score }: { score: number }) {
  const tone =
    score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger';
  return (
    <Badge variant={tone} className="tabular min-w-[36px] justify-center">
      {score}
    </Badge>
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
        Página {current} de {total} · {totalItems.toLocaleString('pt-BR')} no total
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={current <= 1}
          onClick={() => onChange(current - 1)}
        >
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

// ─── Export menu (botão único com dropdown nativo simples) ───────────

function ExportMenu({
  exporting,
  progress,
  onExport,
}: {
  exporting: boolean;
  progress: { page: number; total: number } | null;
  onExport: (f: 'csv' | 'xlsx' | 'docx' | 'pdf') => void;
}) {
  const [open, setOpen] = useState(false);

  if (exporting) {
    return (
      <Button variant="secondary" loading>
        {progress ? `Exportando ${progress.page}/${progress.total}…` : 'Exportando…'}
      </Button>
    );
  }

  return (
    <div className="relative">
      <Button
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        leftIcon={<Download className="h-3.5 w-3.5" />}
        data-testid="cliente-export-btn"
      >
        Exportar
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            className={cn(
              'absolute right-0 top-full mt-1 z-40',
              'min-w-[160px] bg-surface-elevated border border-border-strong rounded-md shadow-lg',
              'flex flex-col p-1 animate-fade-in',
            )}
          >
            <ExportMenuItem
              icon={<FileText className="h-3.5 w-3.5" />}
              label="CSV"
              onClick={() => {
                setOpen(false);
                onExport('csv');
              }}
            />
            <ExportMenuItem
              icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
              label="Excel (XLSX)"
              testId="cliente-export-xlsx-btn"
              onClick={() => {
                setOpen(false);
                onExport('xlsx');
              }}
            />
            <ExportMenuItem
              icon={<File className="h-3.5 w-3.5" />}
              label="Word (DOCX)"
              testId="cliente-export-docx-btn"
              onClick={() => {
                setOpen(false);
                onExport('docx');
              }}
            />
            <ExportMenuItem
              icon={<File className="h-3.5 w-3.5" />}
              label="PDF"
              testId="cliente-export-pdf-btn"
              onClick={() => {
                setOpen(false);
                onExport('pdf');
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ExportMenuItem({
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
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 text-left text-sm rounded',
        'text-text hover:bg-surface-hover transition-colors',
      )}
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}

// ─── Detail drawer ─────────────────────────────────────────────

function ClienteDetailDrawer({
  id,
  onClose,
  onEdit,
  onDeleted,
  onCreatePedido,
  isMobile,
}: {
  id: string;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onCreatePedido: (c: ClienteOpt) => void;
  isMobile: boolean;
}) {
  const { data, loading } = useApiQuery<Cliente>(`/clientes/${id}`);
  const navigate = useNavigate();

  return (
    <Drawer
      open
      onClose={onClose}
      title={data?.nome ?? 'Cliente'}
      description={data?.cnpj ? data.cnpj : undefined}
      width={isMobile ? 'sm' : 'md'}
      footer={
        data && (
          <>
            <DeleteClienteButton id={id} onDeleted={onDeleted} />
            <div className="flex-1" />
            <Button
              variant="secondary"
              size="sm"
              data-testid="cliente-criar-pedido"
              onClick={() =>
                onCreatePedido({ id: data.id, nome: data.nome, cnpj: data.cnpj ?? null })
              }
              leftIcon={<Receipt className="h-3.5 w-3.5" />}
            >
              Criar pedido
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate(`/clientes/${id}`)}
              leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
            >
              Abrir página
            </Button>
            <Button onClick={onEdit}>Editar</Button>
          </>
        )
      }
    >
      {loading || !data ? (
        <div className="flex flex-col gap-3">
          <div className="h-16 rounded-md bg-surface-hover animate-pulse" />
          <div className="h-32 rounded-md bg-surface-hover animate-pulse" />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Avatar name={data.nome} size="xl" />
            <div className="flex-1 min-w-0">
              <h3 className="text-md font-semibold text-text tracking-tight truncate">
                {data.nome}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={STATUS_VARIANT[data.status]}>{STATUS_LABEL[data.status]}</Badge>
                <Badge variant={OMIE_VARIANT[data.omieStatus]} size="sm">
                  OMIE {data.omieStatus === 'ATIVO' ? 'ativo' : 'bloqueado'}
                </Badge>
                <ScorePill score={data.score} />
              </div>
            </div>
          </div>

          <DetailSection title="Contato">
            <DetailRow icon={<Mail />} label="E-mail" value={data.email} />
            <DetailRow icon={<Phone />} label="Telefone" value={data.telefone} />
            <DetailRow icon={<Hash />} label="CNPJ" value={data.cnpj} mono />
            <DetailRow icon={<Building2 />} label="Segmento" value={data.segmento} />
          </DetailSection>

          <DetailSection title="Endereço">
            <DetailRow
              icon={<MapPin />}
              label="Endereço"
              value={fmtEndereco(data)}
            />
            <DetailRow icon={<MapPin />} label="Bairro" value={data.bairro} />
            <DetailRow
              icon={<MapPin />}
              label="Cidade"
              value={data.cidade ? `${data.cidade}${data.uf ? ' · ' + data.uf : ''}` : null}
            />
            <DetailRow icon={<MapPin />} label="CEP" value={data.cep} mono />
          </DetailSection>

          <DetailSection title="Comercial">
            <DetailRow
              icon={<UserCog />}
              label="Representante"
              value={data.representante?.nome ?? null}
            />
            {data._count && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                <MiniStat label="Pedidos" value={data._count.pedidos ?? 0} />
                <MiniStat label="Propostas" value={data._count.propostas ?? 0} />
                <MiniStat label="Amostras" value={data._count.amostras ?? 0} />
                <MiniStat label="Ocorrências" value={data._count.ocorrencias ?? 0} />
              </div>
            )}
          </DetailSection>

          {/* Delete button moved to drawer footer pra discoverability */}
        </div>
      )}
    </Drawer>
  );
}

function fmtEndereco(c: Cliente): string | null {
  const parts: string[] = [];
  if (c.endereco) parts.push(c.endereco);
  if (c.numero) parts.push(`nº ${c.numero}`);
  if (c.complemento) parts.push(c.complemento);
  return parts.length > 0 ? parts.join(', ') : null;
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
        {title}
      </h4>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function DetailRow({
  icon,
  label,
  value,
  mono,
}: {
  icon: ReactNode;
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  if (!value) {
    return (
      <div className="flex items-center gap-2.5 text-sm">
        <span className="shrink-0 w-4 h-4 text-muted-light [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
        <span className="text-muted-light">{label}:</span>
        <span className="text-muted-light italic">não informado</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className="shrink-0 w-4 h-4 text-muted mt-0.5 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
      <span className="text-muted w-20 shrink-0">{label}:</span>
      <span className={cn('text-text flex-1 min-w-0 break-words', mono && 'tabular')}>
        {value}
      </span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-bg-alt px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-lg font-semibold text-text tabular tracking-tight">{value}</div>
    </div>
  );
}

// ─── Bulk assign modal ─────────────────────────────────────────

function BulkAssignModal({
  clienteIds,
  onClose,
  onDone,
}: {
  clienteIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [rep, setRep] = useState<RepOpt | null>(null);
  const [removeRep, setRemoveRep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!removeRep && !rep) {
      setError('Selecione um representante (ou marque "Remover rep atual").');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/clientes/atribuir-rep-massa', {
        clienteIds,
        representanteId: removeRep ? null : rep?.id,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Atribuir rep em ${clienteIds.length} cliente${clienteIds.length === 1 ? '' : 's'}`}
      description={removeRep ? 'Vai remover o rep atual de todos.' : 'Cada selecionado vai ficar com este rep.'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            data-testid="bulk-confirm"
            onClick={submit}
            loading={busy}
          >
            {removeRep ? 'Remover rep' : 'Atribuir'}
          </Button>
        </>
      }
    >
      <Field label="Representante">
        <AsyncCombobox<RepOpt>
          testId="bulk-rep-picker"
          endpoint="/users"
          placeholder="Buscar representante…"
          getLabel={(r) => r.nome}
          getSubLabel={(r) => r.email ?? null}
          getId={(r) => r.id}
          value={rep}
          onChange={(r) => {
            setRep(r);
            if (r) setRemoveRep(false);
          }}
          extraQuery={{ role: 'REP' }}
          disabled={removeRep}
        />
      </Field>
      <div className="mt-3">
        <Checkbox
          checked={removeRep}
          onChange={(e) => {
            setRemoveRep(e.target.checked);
            if (e.target.checked) setRep(null);
          }}
          label="Remover atribuição (deixar sem rep)"
        />
      </div>
      {error && (
        <div className="mt-3 px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
    </Dialog>
  );
}

// ─── EditingFormLoader ──────────────────────────────────────────
// Quando user clica "Editar" no drawer, precisamos do cliente completo.
// Fetchamos e abrimos o form.

function EditingFormLoader({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, loading } = useApiQuery<Cliente>(`/clientes/${id}`);
  if (loading || !data) return null;
  return <ClienteFormModal open cliente={data} onClose={onClose} onSaved={onSaved} />;
}

// ─── Form modal (refeito com Dialog primitive) ──────────────────

interface FormState {
  nome: string;
  cnpj: string;
  email: string;
  telefone: string;
  segmento: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  status: ClienteStatus;
  omieStatus: OmieStatus;
  score: number;
  prazoPagamento: number;
}

function emptyForm(c?: Cliente | null): FormState {
  const cc = c ?? ({} as Cliente);
  return {
    nome: cc.nome ?? '',
    cnpj: cc.cnpj ?? '',
    email: cc.email ?? '',
    telefone: cc.telefone ?? '',
    segmento: cc.segmento ?? '',
    cep: cc.cep ?? '',
    endereco: cc.endereco ?? '',
    numero: cc.numero ?? '',
    complemento: cc.complemento ?? '',
    bairro: cc.bairro ?? '',
    cidade: cc.cidade ?? '',
    uf: cc.uf ?? '',
    status: cc.status ?? 'NOVO',
    omieStatus: cc.omieStatus ?? 'ATIVO',
    score: cc.score ?? 50,
    prazoPagamento: 30,
  };
}

function ClienteFormModal({
  open,
  cliente,
  onClose,
  onSaved,
}: {
  open: boolean;
  cliente: Cliente | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(cliente);
  const [form, setForm] = useState<FormState>(emptyForm(cliente));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Campos obrigatórios — aplicam em CREATE e EDIT.
    // Mesmo em edição, o cliente precisa ter todos os campos preenchidos
    // antes de salvar (não aceita salvar parcial).
    const required = [
      ['nome', form.nome, 'Nome obrigatório.', 2],
      ['cnpj', form.cnpj, 'CNPJ obrigatório.'],
      ['email', form.email, 'E-mail obrigatório.'],
      ['telefone', form.telefone, 'Telefone obrigatório.'],
      ['segmento', form.segmento, 'Segmento obrigatório.'],
      ['cep', form.cep, 'CEP obrigatório.'],
      ['endereco', form.endereco, 'Endereço (logradouro) obrigatório.'],
      ['numero', form.numero, 'Número obrigatório.'],
      ['bairro', form.bairro, 'Bairro obrigatório.'],
      ['cidade', form.cidade, 'Cidade obrigatória.'],
      ['uf', form.uf, 'UF obrigatória.'],
    ] as const;
    for (const [, value, msg, min] of required) {
      const v = String(value).trim();
      if (!v || (typeof min === 'number' && v.length < min)) {
        setError(msg);
        return;
      }
    }

    // Validações de formato
    if (!isValidCNPJ(form.cnpj)) {
      setError('CNPJ inválido. Confira os dígitos verificadores.');
      return;
    }
    if (form.uf.trim().length !== 2) {
      setError('UF deve ter 2 letras (ex: SP, RJ).');
      return;
    }
    if (stripMask(form.telefone).length < 10) {
      setError('Telefone incompleto — informe DDD + número.');
      return;
    }
    if (stripMask(form.cep).length !== 8) {
      setError('CEP deve ter 8 dígitos.');
      return;
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      status: form.status,
      omieStatus: form.omieStatus,
      score: form.score,
      prazoPagamento: form.prazoPagamento,
    };
    const optional = [
      'cnpj',
      'email',
      'telefone',
      'segmento',
      'cep',
      'endereco',
      'numero',
      'complemento',
      'bairro',
      'cidade',
      'uf',
    ] as const;
    for (const k of optional) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }

    try {
      if (isEdit && cliente) await api.patch(`/clientes/${cliente.id}`, payload);
      else await api.post('/clientes', payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar cliente' : 'Novo cliente'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="cliente-form"
            data-testid="cliente-save-btn"
            disabled={form.nome.trim().length < 2}
            loading={saving}
          >
            {isEdit ? 'Salvar alterações' : 'Criar cliente'}
          </Button>
        </>
      }
    >
      <form id="cliente-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Nome" required htmlFor="f-nome">
          <Input
            id="f-nome"
            data-testid="cliente-nome-input"
            value={form.nome}
            onChange={(e) => setField('nome', e.target.value)}
            required
            minLength={2}
            maxLength={200}
            placeholder="Razão social ou nome fantasia"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="CNPJ" required hint="00.000.000/0001-00">
            <Input
              data-testid="cliente-cnpj-input"
              value={form.cnpj}
              onChange={(e) => setField('cnpj', maskCNPJ(e.target.value))}
              placeholder="00.000.000/0001-00"
              maxLength={18}
              inputMode="numeric"
              required
            />
          </Field>
          <Field label="Segmento" required>
            <Input
              value={form.segmento}
              onChange={(e) => setField('segmento', e.target.value)}
              placeholder="Ex: Restaurante, Supermercado…"
              required
              maxLength={60}
            />
          </Field>
          <Field label="E-mail" required>
            <Input
              type="email"
              leftIcon={<Mail />}
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              required
              maxLength={200}
              placeholder="contato@empresa.com.br"
            />
          </Field>
          <Field label="Telefone" required>
            <Input
              leftIcon={<Phone />}
              value={form.telefone}
              onChange={(e) => setField('telefone', maskTelefone(e.target.value))}
              placeholder="(00) 00000-0000"
              maxLength={15}
              inputMode="tel"
              required
            />
          </Field>
        </div>

        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Endereço
          </h4>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-[160px_1fr_120px]">
            <Field label="CEP" required hint="00000-000">
              <Input
                value={form.cep}
                onChange={(e) => setField('cep', maskCEP(e.target.value))}
                placeholder="00000-000"
                maxLength={9}
                inputMode="numeric"
                required
              />
            </Field>
            <Field label="Logradouro" required>
              <Input
                value={form.endereco}
                onChange={(e) => setField('endereco', e.target.value)}
                placeholder="Rua, avenida, etc."
                maxLength={200}
                required
              />
            </Field>
            <Field label="Número" required>
              <Input
                value={form.numero}
                onChange={(e) => setField('numero', e.target.value)}
                maxLength={20}
                required
              />
            </Field>
          </div>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 mt-3">
            <Field label="Complemento" hint="Opcional">
              <Input
                value={form.complemento}
                onChange={(e) => setField('complemento', e.target.value)}
                maxLength={100}
                placeholder="Sala, andar, bloco…"
              />
            </Field>
            <Field label="Bairro" required>
              <Input
                value={form.bairro}
                onChange={(e) => setField('bairro', e.target.value)}
                maxLength={100}
                required
              />
            </Field>
            <Field label="Cidade" required>
              <Input
                value={form.cidade}
                onChange={(e) => setField('cidade', e.target.value)}
                maxLength={100}
                required
              />
            </Field>
            <Field label="UF" required>
              <Input
                maxLength={2}
                value={form.uf}
                onChange={(e) => setField('uf', normalizeUF(e.target.value))}
                placeholder="SP"
                required
              />
            </Field>
          </div>
        </section>

        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Operação
          </h4>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as ClienteStatus)}
              >
                {(Object.keys(STATUS_LABEL) as ClienteStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="OMIE">
              <Select
                value={form.omieStatus}
                onChange={(e) => setField('omieStatus', e.target.value as OmieStatus)}
              >
                <option value="ATIVO">Ativo</option>
                <option value="BLOQUEADO">Bloqueado</option>
              </Select>
            </Field>
            <Field label="Score">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.score}
                onChange={(e) => setField('score', Number(e.target.value))}
              />
            </Field>
            <Field label="Prazo (dias)">
              <Input
                type="number"
                min={0}
                max={180}
                value={form.prazoPagamento}
                onChange={(e) => setField('prazoPagamento', Number(e.target.value))}
              />
            </Field>
          </div>
        </section>

        {error && (
          <div
            data-testid="form-error"
            className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}

// ─── Delete cliente button ─────────────────────────────────────

function DeleteClienteButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    setBusy(true);
    try {
      await api.delete(`/clientes/${id}`);
      toast.success('Cliente excluído');
      onDeleted();
    } catch (err) {
      toast.error('Falha ao excluir', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Button
        variant="danger"
        size="sm"
        onClick={() => setConfirming(true)}
        leftIcon={<Trash2 className="h-3.5 w-3.5" />}
      >
        Excluir cliente
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-danger">Confirmar exclusão?</span>
      <Button
        variant="danger"
        size="sm"
        disabled={busy}
        loading={busy}
        onClick={doDelete}
      >
        Sim, excluir
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
        Cancelar
      </Button>
    </div>
  );
}
