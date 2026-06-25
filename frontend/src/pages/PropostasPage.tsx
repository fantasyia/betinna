import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search,
  Plus,
  ExternalLink,
  ArrowRight,
  AlertCircle,
  FileText,
  Calendar,
  TrendingUp,
  Percent,
  CreditCard,
  ShoppingCart,
  Trash2,
  CheckCircle2,
  X as XIcon,
  FileSpreadsheet,
  Mail,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useEmpresaConfig, descontoAVistaPct } from '@/hooks/useEmpresaConfig';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { VendasTabs } from '@/components/VendasTabs';
import { StateView } from '@/components/StateView';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  formatMoeda as fmtBRL,
  formatNumero,
} from '@/lib/masks';

/**
 * PropostasPage v2 — design system dark, drawer detail + transitions visuais.
 *
 * - List page com cards de proposta + probabilidade barra
 * - Drawer com lifecycle (transitions disponíveis em pílulas clicáveis)
 * - Form Dialog grande com itens dinâmicos + preview de total
 */

type PropostaStatus =
  | 'RASCUNHO'
  | 'ENVIADA'
  | 'NEGOCIACAO'
  | 'AGUARDANDO_ASSINATURA'
  | 'ACEITA'
  | 'RECUSADA'
  | 'EXPIRADA';

type PagamentoForma = 'BOLETO' | 'PIX' | 'TED' | 'CARTAO' | 'DINHEIRO';
type CondicaoPgto = 'avista' | '15dias' | '30dias' | '30_60' | '30_60_90';

interface Proposta {
  id: string;
  numero: string | number;
  status: PropostaStatus;
  valor: number;
  probabilidade: number;
  validoAte?: string | null;
  cliente?: { id: string; nome: string };
  representante?: { id: string; nome: string };
  criadoEm: string;
  pedidoId?: string | null;
}

interface PropostaItemDetail {
  id: string;
  produto?: { id: string; nome: string; sku?: string };
  quantidade: number;
  precoUnitario: number;
  desconto: number;
  total: number;
}

interface PropostaDetail extends Proposta {
  subtotal?: number;
  descontoTotal?: number;
  descontoGeral?: number;
  formaPagamento?: PagamentoForma;
  condicaoPagamento?: CondicaoPgto;
  observacoes?: string | null;
  prazoEntrega?: string | null;
  itens?: PropostaItemDetail[];
}

interface ClienteOpt {
  id: string;
  nome: string;
  cnpj?: string | null;
}

interface ProdutoOpt {
  id: string;
  nome: string;
  sku?: string | null;
  precoTabela?: number;
  /** unidade de medida do produto (read-only — vem do Omie). Ex: "cx", "un", "kg". */
  unidade?: string | null;
}

const STATUS_VARIANT: Record<
  PropostaStatus,
  'neutral' | 'info' | 'warning' | 'primary' | 'success' | 'danger'
> = {
  RASCUNHO: 'neutral',
  ENVIADA: 'info',
  NEGOCIACAO: 'warning',
  AGUARDANDO_ASSINATURA: 'primary',
  ACEITA: 'success',
  RECUSADA: 'danger',
  EXPIRADA: 'neutral',
};

const STATUS_LABEL: Record<PropostaStatus, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADA: 'Enviada',
  NEGOCIACAO: 'Em negociação',
  AGUARDANDO_ASSINATURA: 'Aguard. assinatura',
  ACEITA: 'Aceita',
  RECUSADA: 'Recusada',
  EXPIRADA: 'Expirada',
};

const STATUS_LIST: PropostaStatus[] = [
  'RASCUNHO',
  'ENVIADA',
  'NEGOCIACAO',
  'AGUARDANDO_ASSINATURA',
  'ACEITA',
  'RECUSADA',
  'EXPIRADA',
];

const CONDICOES: { value: CondicaoPgto; label: string }[] = [
  { value: 'avista', label: 'À vista' },
  { value: '15dias', label: '15 dias' },
  { value: '30dias', label: '30 dias' },
  { value: '30_60', label: '30/60' },
  { value: '30_60_90', label: '30/60/90' },
];

const FORMAS: PagamentoForma[] = ['BOLETO', 'PIX', 'TED', 'CARTAO', 'DINHEIRO'];

const TRANSITIONS: Partial<Record<PropostaStatus, PropostaStatus[]>> = {
  RASCUNHO: ['ENVIADA', 'EXPIRADA'],
  ENVIADA: ['NEGOCIACAO', 'AGUARDANDO_ASSINATURA', 'ACEITA', 'RECUSADA', 'EXPIRADA'],
  NEGOCIACAO: ['AGUARDANDO_ASSINATURA', 'ACEITA', 'RECUSADA', 'EXPIRADA'],
  AGUARDANDO_ASSINATURA: ['ACEITA', 'RECUSADA', 'EXPIRADA'],
};

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

// ─── Page principal ──────────────────────────────────────────

export default function PropostasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Auto-abre drawer quando vem com ?highlight=ID
  useEffect(() => {
    const highlight = searchParams.get('highlight');
    if (highlight && highlight !== selected) {
      setSelected(highlight);
      const next = new URLSearchParams(searchParams);
      next.delete('highlight');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const clienteIdFilter = searchParams.get('clienteId') || '';

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) qs.set('search', search.trim());
    if (status) qs.set('status', status);
    if (clienteIdFilter) qs.set('clienteId', clienteIdFilter);
    return `/propostas?${qs.toString()}`;
  }, [page, search, status, clienteIdFilter]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Proposta>>(listPath);
  const filtersActive = !!status || !!search.trim();

  return (
    <PageLayout
      title="Propostas"
      description={
        pageResp?.pagination
          ? `${formatNumero(pageResp.pagination.total)} propostas no total`
          : undefined
      }
      actions={
        <Button
          data-testid="proposta-new-btn"
          onClick={() => setCreating(true)}
          leftIcon={<Plus className="h-3.5 w-3.5" />}
        >
          Nova proposta
        </Button>
      }
    >
      <VendasTabs />
      {clienteIdFilter && (
        <div
          data-testid="propostas-cliente-filter-banner"
          className="mb-3 px-3 py-2 rounded-md bg-info/10 border border-info/30 text-sm flex items-center gap-2"
        >
          <span className="flex-1 text-text">
            Filtrando propostas de um cliente específico.
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('clienteId');
              setSearchParams(next, { replace: true });
            }}
          >
            Ver todas
          </Button>
        </div>
      )}
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
          <Input
            leftIcon={<Search />}
            placeholder="Cliente, número…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
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
            {STATUS_LIST.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<XIcon className="h-3 w-3" />}
              onClick={() => {
                setSearch('');
                setStatus('');
                setPage(1);
              }}
            >
              Limpar
            </Button>
          )}
        </div>

        <StateView loading={loading} error={error} onRetry={refetch}>
          {pageResp && pageResp.data.length === 0 && (
            <EmptyState
              icon={<FileText />}
              title="Nenhuma proposta encontrada"
              description={
                filtersActive
                  ? 'Ajuste os filtros pra ver mais resultados.'
                  : 'Crie a primeira proposta pra começar.'
              }
              action={
                !filtersActive ? (
                  <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                    Nova proposta
                  </Button>
                ) : undefined
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
                      <Th>Proposta</Th>
                      <Th>Cliente</Th>
                      <Th>Representante</Th>
                      <Th align="right">Valor</Th>
                      <Th>Probabilidade</Th>
                      <Th>Status</Th>
                      <Th>Validade</Th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageResp.data.map((p) => (
                      <tr
                        key={p.id}
                        className={cn(
                          'border-b border-border last:border-b-0 cursor-pointer transition-colors',
                          p.id === selected ? 'bg-surface-hover' : 'hover:bg-surface-hover/60',
                        )}
                        onClick={() => setSelected(p.id)}
                        data-testid={`proposta-row-${p.id}`}
                      >
                        <Td>
                          <div className="flex flex-col">
                            <strong className="text-sm text-text tabular">#{p.numero}</strong>
                            {p.pedidoId && (
                              <Badge variant="success" size="sm" className="w-fit mt-0.5">
                                Pedido gerado
                              </Badge>
                            )}
                          </div>
                        </Td>
                        <Td>
                          {p.cliente ? (
                            <div className="flex items-center gap-2 min-w-0">
                              <Avatar name={p.cliente.nome} size="sm" />
                              <span className="text-sm text-text truncate">{p.cliente.nome}</span>
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
                            {fmtBRL(p.valor)}
                          </span>
                        </Td>
                        <Td>
                          <ProbabilityPill prob={p.probabilidade} />
                        </Td>
                        <Td>
                          <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                        </Td>
                        <Td>
                          <span className="text-sm text-text-subtle tabular">
                            {fmtDate(p.validoAte)}
                          </span>
                        </Td>
                        <Td>
                          <ExternalLink className="h-3.5 w-3.5 text-muted" />
                        </Td>
                      </tr>
                    ))}
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
        <PropostaDetailDrawer
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            refetch();
          }}
        />
      )}
      {creating && (
        <PropostaFormDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
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
      className={cn('px-4 py-2.5 align-middle', align === 'right' ? 'text-right' : 'text-left')}
    >
      {children}
    </td>
  );
}

function ProbabilityPill({ prob }: { prob: number }) {
  const tone = prob >= 70 ? 'success' : prob >= 30 ? 'warning' : 'danger';
  const color =
    tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-danger';
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-surface-hover overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${prob}%` }} />
      </div>
      <span className="text-xs tabular text-text-subtle min-w-[32px] text-right">{prob}%</span>
    </div>
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

// ─── Detail drawer ─────────────────────────────────────────────

function PropostaDetailDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<PropostaDetail>(`/propostas/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [transition, setTransition] = useState<PropostaStatus | null>(null);
  const [motivo, setMotivo] = useState('');

  async function doTransition() {
    if (!transition) return;
    setBusy(true);
    setActionError(null);
    try {
      const payload: Record<string, unknown> = { status: transition };
      if (motivo.trim()) payload.motivo = motivo.trim();
      await api.put(`/propostas/${id}/status`, payload);
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao mudar status');
      refetch();
    } finally {
      setBusy(false);
    }
  }

  async function doConverter() {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/propostas/${id}/converter-em-pedido`);
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao converter');
      refetch();
    } finally {
      setBusy(false);
    }
  }

  // ─── C2 — Exportar / enviar ──────────────────────────────────────────
  const [exportBusy, setExportBusy] = useState<'pdf' | 'excel' | 'email' | 'aceite' | null>(null);
  // C3 — link de aceite externo gerado
  const [aceiteLink, setAceiteLink] = useState<string | null>(null);

  /** Converte base64 → Blob e dispara download no navegador. */
  function baixarBase64(base64: string, filename: string, mime: string) {
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportar(tipo: 'pdf' | 'excel') {
    setExportBusy(tipo);
    setActionError(null);
    try {
      const res = await api.get<{ filename: string; base64: string }>(`/propostas/${id}/${tipo}`);
      const mime =
        tipo === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      baixarBase64(res.base64, res.filename, mime);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : `Falha ao gerar ${tipo}`);
    } finally {
      setExportBusy(null);
    }
  }

  async function enviarEmail() {
    setExportBusy('email');
    setActionError(null);
    try {
      const res = await api.post<{ ok: boolean; enviadoPara: string }>(
        `/propostas/${id}/enviar-email`,
      );
      toast.success('Proposta enviada', `E-mail enviado pra ${res.enviadoPara}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao enviar e-mail');
    } finally {
      setExportBusy(null);
    }
  }

  // C3 — gera link de aceite externo pra enviar ao cliente
  async function gerarAceite() {
    setExportBusy('aceite');
    setActionError(null);
    try {
      const res = await api.post<{ url: string; expiraEm: string }>(
        `/propostas/${id}/enviar-aceite`,
      );
      setAceiteLink(res.url);
      onChanged(); // status virou AGUARDANDO_ASSINATURA — atualiza lista
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao gerar link de aceite');
    } finally {
      setExportBusy(null);
    }
  }

  const allowed = data ? TRANSITIONS[data.status] ?? [] : [];
  const exigeMotivo = transition === 'RECUSADA';

  return (
    <Drawer
      open
      onClose={onClose}
      title={data ? `Proposta #${data.numero}` : 'Proposta'}
      description={data?.cliente?.nome}
      width="lg"
      footer={
        data?.status === 'ACEITA' && !data.pedidoId ? (
          <Button
            data-testid="proposta-converter"
            onClick={doConverter}
            loading={busy}
            leftIcon={<ShoppingCart className="h-3.5 w-3.5" />}
          >
            Converter em pedido
          </Button>
        ) : undefined
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div className="flex flex-col gap-5">
            {/* C2 — Barra de exportação/envio */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                data-testid="proposta-export-pdf"
                loading={exportBusy === 'pdf'}
                disabled={exportBusy !== null}
                onClick={() => void exportar('pdf')}
                leftIcon={<FileText className="h-3.5 w-3.5" />}
              >
                PDF
              </Button>
              <Button
                variant="secondary"
                size="sm"
                data-testid="proposta-export-excel"
                loading={exportBusy === 'excel'}
                disabled={exportBusy !== null}
                onClick={() => void exportar('excel')}
                leftIcon={<FileSpreadsheet className="h-3.5 w-3.5" />}
              >
                Excel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                data-testid="proposta-enviar-email"
                loading={exportBusy === 'email'}
                disabled={exportBusy !== null}
                onClick={() => void enviarEmail()}
                leftIcon={<Mail className="h-3.5 w-3.5" />}
              >
                Enviar por e-mail
              </Button>
              {/* C3 — link de aceite externo (oculto pra propostas já aceitas/recusadas) */}
              {data.status !== 'ACEITA' && data.status !== 'RECUSADA' && (
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="proposta-enviar-aceite"
                  loading={exportBusy === 'aceite'}
                  disabled={exportBusy !== null}
                  onClick={() => void gerarAceite()}
                  leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
                >
                  Enviar pra cliente aprovar
                </Button>
              )}
            </div>

            {/* C3 — link gerado: copiar pra enviar ao cliente */}
            {aceiteLink && (
              <div
                className="px-3 py-2.5 rounded-md bg-success/10 border border-success/30"
                data-testid="proposta-aceite-link"
              >
                <p className="text-sm font-medium text-text m-0 mb-1.5">
                  Link de aprovação gerado — envie pro cliente:
                </p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={aceiteLink}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="flex-1 text-xs px-2 py-1.5 rounded border border-border bg-surface text-text-subtle font-mono"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(aceiteLink);
                      toast.success('Link copiado');
                    }}
                  >
                    Copiar
                  </Button>
                </div>
                <p className="text-[11px] text-muted m-0 mt-1.5">
                  O cliente abre o link, vê a proposta e aceita/recusa. Ao aceitar, um pedido
                  é criado automaticamente. Link válido por 7 dias.
                </p>
              </div>
            )}

            {/* Header card */}
            <Card variant="outline" padding="md" className="bg-bg-alt">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted mb-1">Valor</div>
                  <div className="text-3xl font-bold text-text tabular tracking-tight">
                    {fmtBRL(data.valor)}
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <Badge variant={STATUS_VARIANT[data.status]}>{STATUS_LABEL[data.status]}</Badge>
                    {data.pedidoId && (
                      <Badge variant="success" size="sm">
                        Pedido gerado
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] uppercase tracking-wider text-muted mb-1">
                    Probabilidade
                  </div>
                  <div className="text-2xl font-bold tabular text-text">{data.probabilidade}%</div>
                </div>
              </div>
            </Card>

            {/* Info */}
            <section>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                Resumo
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <InfoCell
                  icon={<Calendar />}
                  label="Criada em"
                  value={fmtDate(data.criadoEm)}
                />
                <InfoCell icon={<Calendar />} label="Validade" value={fmtDate(data.validoAte)} />
                <InfoCell
                  icon={<CreditCard />}
                  label="Pagamento"
                  value={
                    data.formaPagamento || data.condicaoPagamento
                      ? `${data.formaPagamento ?? '—'} · ${data.condicaoPagamento ?? '—'}`
                      : null
                  }
                />
                <InfoCell
                  icon={<Percent />}
                  label="Desconto geral"
                  value={
                    data.descontoGeral !== undefined && data.descontoGeral > 0
                      ? `${data.descontoGeral}%`
                      : null
                  }
                />
                <InfoCell
                  icon={<TrendingUp />}
                  label="Subtotal"
                  value={data.subtotal !== undefined ? fmtBRL(data.subtotal) : null}
                  mono
                />
                <InfoCell
                  icon={<TrendingUp />}
                  label="Desconto total"
                  value={data.descontoTotal !== undefined ? fmtBRL(data.descontoTotal) : null}
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
                          Desc
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
                            {fmtBRL(it.precoUnitario)}
                          </td>
                          <td className="px-3 py-2 text-right text-sm text-text-subtle tabular">
                            {it.desconto > 0 ? `${it.desconto}%` : '—'}
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

            {data.observacoes && (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                  Observações
                </h4>
                <p className="text-sm text-text-subtle leading-relaxed whitespace-pre-wrap m-0">
                  {data.observacoes}
                </p>
              </section>
            )}

            {/* Transitions */}
            {allowed.length > 0 && (
              <section className="pt-4 border-t border-border">
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-3">
                  Mudar status
                </h4>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {allowed.map((s) => (
                    <button
                      key={s}
                      type="button"
                      data-testid={`proposta-status-${s}`}
                      onClick={() => setTransition(s)}
                      className={cn(
                        'flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium',
                        'border transition-colors duration-100',
                        transition === s
                          ? 'bg-primary/15 border-primary/40 text-primary'
                          : 'bg-surface border-border text-text-subtle hover:bg-surface-hover hover:border-border-strong hover:text-text',
                      )}
                    >
                      <ArrowRight className="h-3 w-3" />
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
                {transition && (
                  <div className="flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                    <p className="text-sm text-text">
                      Mudar pra <strong>{STATUS_LABEL[transition]}</strong>?
                    </p>
                    {exigeMotivo && (
                      <Field label="Motivo" required hint="Obrigatório ao recusar">
                        <Textarea
                          data-testid="proposta-motivo-input"
                          value={motivo}
                          onChange={(e) => setMotivo(e.target.value)}
                          placeholder="Por que recusada?"
                          rows={3}
                        />
                      </Field>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setTransition(null)}
                      >
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        data-testid="proposta-status-confirm"
                        disabled={exigeMotivo && motivo.trim().length === 0}
                        loading={busy}
                        onClick={doTransition}
                        leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                      >
                        Confirmar
                      </Button>
                    </div>
                  </div>
                )}
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
    </Drawer>
  );
}

function InfoCell({
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
      <div className={cn('text-sm text-text truncate', mono && 'tabular')}>{value}</div>
    </div>
  );
}

// ─── Form Dialog ─────────────────────────────────────────────

interface FormItem {
  uiKey: string;
  produto: ProdutoOpt | null;
  quantidade: number;
  desconto: number;
  precoUnitarioOverride: string;
}

function newFormItem(): FormItem {
  return {
    uiKey: Math.random().toString(36).slice(2),
    produto: null,
    quantidade: 1,
    desconto: 0,
    precoUnitarioOverride: '',
  };
}

function PropostaFormDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  const [itens, setItens] = useState<FormItem[]>([newFormItem()]);
  const [formaPagamento, setFormaPagamento] = useState<PagamentoForma>('BOLETO');
  const [condicaoPagamento, setCondicaoPagamento] = useState<CondicaoPgto>('30dias');
  const [descontoGeral, setDescontoGeral] = useState(0);
  const [probabilidade, setProbabilidade] = useState(50);
  const [validoAte, setValidoAte] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setItem(idx: number, patch: Partial<FormItem>) {
    setItens((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItens((arr) => (arr.length > 1 ? arr.filter((_, i) => i !== idx) : arr));
  }
  function addItem() {
    setItens((arr) => [...arr, newFormItem()]);
  }

  // B1 — desconto à vista da empresa (pra preview)
  const { data: empresaCfg } = useEmpresaConfig();
  const descAVistaPctPreview = descontoAVistaPct(empresaCfg, formaPagamento, condicaoPagamento);

  const subtotal = itens.reduce((acc, it) => {
    if (!it.produto) return acc;
    const unit =
      it.precoUnitarioOverride.trim()
        ? Number(it.precoUnitarioOverride) || 0
        : it.produto.precoTabela ?? 0;
    const bruto = unit * it.quantidade;
    return acc + bruto * (1 - it.desconto / 100);
  }, 0);
  // Soma desconto geral (manual) + à vista (automático), capado em 90% — igual backend.
  const descontoTotalPct = Math.min(90, descontoGeral + descAVistaPctPreview);
  const totalComDescGeral = subtotal * (1 - descontoTotalPct / 100);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Validação client-side com feedback claro
    if (!cliente) {
      setError('Selecione um cliente antes de criar a proposta.');
      return;
    }
    if (itens.length === 0) {
      setError('Adicione ao menos um item.');
      return;
    }
    const semProduto = itens.findIndex((it) => !it.produto);
    if (semProduto !== -1) {
      setError(`Selecione o produto do item ${semProduto + 1}.`);
      return;
    }
    const qtInvalida = itens.findIndex((it) => it.quantidade < 1);
    if (qtInvalida !== -1) {
      setError(`Quantidade do item ${qtInvalida + 1} precisa ser pelo menos 1.`);
      return;
    }
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      clienteId: cliente.id,
      itens: itens.map((it) => {
        const obj: Record<string, unknown> = {
          produtoId: it.produto!.id,
          quantidade: it.quantidade,
          desconto: it.desconto,
        };
        if (it.precoUnitarioOverride.trim()) {
          obj.precoUnitarioOverride = Number(it.precoUnitarioOverride);
        }
        return obj;
      }),
      formaPagamento,
      condicaoPagamento,
      descontoGeral,
      probabilidade,
    };
    if (validoAte) payload.validoAte = validoAte;
    if (observacoes.trim()) payload.observacoes = observacoes.trim();

    try {
      await api.post('/propostas', payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar proposta');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nova proposta"
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="proposta-form"
            data-testid="proposta-save-btn"
            loading={busy}
            leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
          >
            Criar como rascunho
          </Button>
        </>
      }
    >
      <form id="proposta-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Cliente" required>
          <AsyncCombobox<ClienteOpt>
            testId="cliente-picker"
            endpoint="/clientes"
            placeholder="Buscar cliente por nome ou CNPJ…"
            getLabel={(c) => c.nome}
            getSubLabel={(c) => c.cnpj ?? null}
            getId={(c) => c.id}
            value={cliente}
            onChange={setCliente}
          />
        </Field>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Itens ({itens.length})
            </h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addItem}
              leftIcon={<Plus className="h-3 w-3" />}
              data-testid="proposta-add-item"
            >
              Adicionar item
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {/* Header row — labels visíveis pra cada coluna do item */}
            {itens.length > 0 && (
              <div
                className="hidden sm:grid grid-cols-[1fr_70px_70px_90px_32px] gap-2 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted"
                aria-hidden="true"
              >
                <span>Produto</span>
                <span>Qtde</span>
                <span>% Desc.</span>
                <span>Preço un.</span>
                <span />
              </div>
            )}
            {itens.map((it, idx) => (
              <ItemRow
                key={it.uiKey}
                item={it}
                onChange={(patch) => setItem(idx, patch)}
                onRemove={itens.length > 1 ? () => removeItem(idx) : null}
                testId={`item-${idx}`}
              />
            ))}
          </div>
        </section>

        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Pagamento & validade
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Forma de pagamento">
              <Select
                value={formaPagamento}
                onChange={(e) => setFormaPagamento(e.target.value as PagamentoForma)}
              >
                {FORMAS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Condição">
              <Select
                value={condicaoPagamento}
                onChange={(e) => setCondicaoPagamento(e.target.value as CondicaoPgto)}
              >
                {CONDICOES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Validade">
              <Input
                type="date"
                value={validoAte}
                onChange={(e) => setValidoAte(e.target.value)}
              />
            </Field>
            <Field label="Desconto geral (%)">
              <Input
                type="number"
                min={0}
                max={50}
                step="0.1"
                value={descontoGeral}
                onChange={(e) => setDescontoGeral(Number(e.target.value))}
              />
            </Field>
            <Field label="Probabilidade (%)">
              <Input
                type="number"
                min={0}
                max={100}
                value={probabilidade}
                onChange={(e) => setProbabilidade(Number(e.target.value))}
              />
            </Field>
          </div>
        </section>

        <Field label="Observações" hint="Notas internas, prazos especiais…">
          <Textarea
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={3}
          />
        </Field>

        {/* Total preview */}
        <Card variant="outline" padding="md" className="bg-primary/5 border-primary/30">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted">Total estimado</div>
              <div className="text-2xl font-bold text-text tabular tracking-tight">
                {fmtBRL(totalComDescGeral)}
              </div>
            </div>
            <div className="text-right text-[11px] text-muted tabular">
              <div>Subtotal: {fmtBRL(subtotal)}</div>
              {descontoGeral > 0 && <div>Desconto geral: {descontoGeral}%</div>}
              {descAVistaPctPreview > 0 && (
                <div className="text-success">Desconto à vista: {descAVistaPctPreview}%</div>
              )}
              <div className="text-muted-light mt-1">Backend recalcula no save.</div>
            </div>
          </div>
        </Card>

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

function ItemRow({
  item,
  onChange,
  onRemove,
  testId,
}: {
  item: FormItem;
  onChange: (patch: Partial<FormItem>) => void;
  onRemove: (() => void) | null;
  testId: string;
}) {
  return (
    // Mobile: empilha (produto em linha cheia; qtd/desc/preço/remover na 2ª linha).
    // Desktop (sm): grade de 5 colunas — o wrapper interno vira `sm:contents` e
    // dissolve, deixando qtd/desc/preço/remover virarem as colunas 2-5 da grade.
    <div
      data-testid={testId}
      className="flex flex-col gap-2 p-2.5 rounded-md border border-border bg-bg-alt sm:grid sm:grid-cols-[1fr_70px_70px_90px_32px] sm:items-start"
    >
      <AsyncCombobox<ProdutoOpt>
        testId={`${testId}-produto`}
        endpoint="/produtos"
        placeholder="Buscar produto…"
        getLabel={(p) => p.nome}
        getSubLabel={(p) =>
          [p.sku, p.precoTabela !== undefined ? fmtBRL(p.precoTabela) : null]
            .filter(Boolean)
            .join(' · ')
        }
        getId={(p) => p.id}
        value={item.produto}
        onChange={(p) => onChange({ produto: p })}
      />
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-start gap-2 sm:contents">
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={1}
          value={item.quantidade}
          // `|| 1` evita NaN (texto não-numérico → Math.max(1, NaN) seria NaN).
          onChange={(e) => onChange({ quantidade: Math.max(1, Number(e.target.value) || 1) })}
          data-testid={`${testId}-qt`}
          aria-label="Quantidade"
          className="flex-1 min-w-0"
        />
        {/* Unidade vem do produto (read-only — sincronizado do Omie) */}
        <span
          className="text-[11px] text-muted whitespace-nowrap"
          data-testid={`${testId}-unidade`}
          title="Unidade de medida (vem do Omie)"
        >
          {item.produto?.unidade ?? 'un'}
        </span>
      </div>
      <Input
        type="number"
        min={0}
        max={80}
        step="0.1"
        value={item.desconto}
        // Clamp no ESTADO [0,80] (max=80 do DOM não impede digitar fora) — senão desconto>100
        // deixava o subtotal-preview negativo, divergindo do que o backend recalcula/salva.
        onChange={(e) => onChange({ desconto: Math.min(80, Math.max(0, Number(e.target.value) || 0)) })}
        data-testid={`${testId}-desc`}
        aria-label="Desconto %"
        placeholder="%"
      />
      <Input
        type="number"
        min={0}
        step="0.01"
        value={item.precoUnitarioOverride}
        onChange={(e) => {
          const v = e.target.value.replace(',', '.');
          if (v === '' || /^\d*\.?\d*$/.test(v)) {
            onChange({ precoUnitarioOverride: v });
          }
        }}
        data-testid={`${testId}-override`}
        aria-label="Preço override"
        placeholder="preço"
      />
      {onRemove ? (
        <IconButton
          aria-label="Remover item"
          variant="danger"
          size="sm"
          icon={<Trash2 />}
          onClick={onRemove}
          data-testid={`${testId}-remove`}
          className="self-center"
        />
      ) : (
        <span />
      )}
      </div>
    </div>
  );
}

