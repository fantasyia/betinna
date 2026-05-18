import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Send,
  ArrowRight,
  Check,
  AlertCircle,
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
  Printer,
  ArrowLeft,
  Copy,
  Edit3,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { NovoPedidoDialog, type NovoPedidoInicial } from '@/components/NovoPedidoDialog';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * PedidoDetailPage — versão página cheia do pedido (vs Drawer).
 *
 * Use quando precisar de espaço pra ler/imprimir (rep no escritório ou
 * gerente revisando antes de aprovar desconto). Drawer continua sendo
 * o caminho rápido pra peek.
 *
 * Rota: /pedidos/:id
 *
 * TODO: extrair os helpers compartilhados com PedidosPage.tsx
 * (STATUS_LABEL, StatusTimeline, etc.) pra `@/components/PedidoDetailView`
 * quando bater a 3ª duplicação.
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

interface PedidoDetail {
  id: string;
  numero: string | number;
  total: number;
  status: PedidoStatus;
  cliente?: { id: string; nome: string; cnpj?: string | null };
  representante?: { id: string; nome: string };
  criadoEm: string;
  numeroOmie?: string | null;
  enviadoOmieEm?: string | null;
  subtotal?: number;
  descontoTotal?: number;
  descontoGeral?: number;
  formaPagamento?: string;
  condicaoPagamento?: string;
  observacao?: string | null;
  observacoes?: string | null;
  itens?: Array<{
    id: string;
    produto?: {
      id: string;
      nome: string;
      sku?: string;
      precoTabela?: number;
      estoque?: number;
      estoqueAtualizadoEm?: string | null;
    };
    quantidade: number;
    precoUnitario: number;
    desconto: number;
    total: number;
  }>;
  enviadoEm?: string | null;
  entregueEm?: string | null;
  pagoEm?: string | null;
  separacaoEm?: string | null;
  canceladoEm?: string | null;
  cancelMotivo?: string | null;
}

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

const FLOW_STEPS: PedidoStatus[] = [
  'RASCUNHO',
  'ENVIADO_OMIE',
  'PAGO',
  'EM_SEPARACAO',
  'ENVIADO',
  'ENTREGUE',
];

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

// ─── Página principal ────────────────────────────────────────────────

export default function PedidoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApiQuery<PedidoDetail>(
    id ? `/pedidos/${id}` : null,
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelMotivo, setCancelMotivo] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  async function callAction(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha na operação');
    } finally {
      setBusy(null);
    }
  }

  const enviarOmie = () =>
    callAction('enviar', () => api.post(`/pedidos/${id}/enviar-omie`));
  const avancar = () =>
    callAction('avancar', () => api.post(`/pedidos/${id}/avancar-status`));
  const doCancel = () =>
    callAction('cancelar', () =>
      api.post(
        `/pedidos/${id}/cancelar`,
        cancelMotivo.trim() ? { motivo: cancelMotivo.trim() } : {},
      ),
    );
  /**
   * Duplicar usa o endpoint dedicado do backend (POST /pedidos/:id/duplicar)
   * que recalcula preços e seta pedidoOrigemId pra rastreabilidade.
   */
  async function duplicar() {
    setBusy('duplicar');
    setActionError(null);
    try {
      const r = await api.post<{ id: string }>(`/pedidos/${id}/duplicar`);
      navigate(`/pedidos/${r.id}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao duplicar');
    } finally {
      setBusy(null);
    }
  }

  if (!id) {
    return (
      <PageLayout title="Pedido">
        <p>ID inválido</p>
      </PageLayout>
    );
  }

  // Constrói inicial pra duplicar a partir do pedido atual.
  // Não copia desconto/preço override — backend recalcula pelo PricingService
  // (preço pode ter mudado desde o pedido original).
  const inicialDuplicar: NovoPedidoInicial | null =
    data && data.itens
      ? {
          itens: data.itens
            .filter((it) => it.produto)
            .map((it) => ({
              produto: {
                id: it.produto!.id,
                nome: it.produto!.nome,
                sku: it.produto!.sku ?? null,
                precoTabela: it.produto!.precoTabela,
                estoque: it.produto!.estoque,
                estoqueAtualizadoEm: it.produto!.estoqueAtualizadoEm ?? null,
              },
              quantidade: it.quantidade,
              desconto: it.desconto,
            })),
          formaPagamento: data.formaPagamento as NovoPedidoInicial['formaPagamento'],
          condicaoPagamento: data.condicaoPagamento as NovoPedidoInicial['condicaoPagamento'],
          descontoGeral: data.descontoGeral ?? 0,
          observacoes: data.observacao ?? data.observacoes ?? '',
        }
      : null;

  const podeEditar = data?.status === 'RASCUNHO' || data?.status === 'AGUARDANDO_APROVACAO';

  return (
    <PageLayout
      title={data ? `Pedido #${data.numero}` : 'Pedido'}
      description={
        data?.numeroOmie ? `OMIE ${data.numeroOmie}` : data?.cliente?.nome ?? undefined
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/pedidos"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium text-text-subtle hover:text-text hover:bg-surface-hover transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar
          </Link>
          <Button
            variant="secondary"
            size="md"
            onClick={() => window.print()}
            leftIcon={<Printer className="h-3.5 w-3.5" />}
            data-testid="pedido-print"
          >
            Imprimir
          </Button>
          {data && (
            <Button
              variant="secondary"
              size="md"
              onClick={duplicar}
              loading={busy === 'duplicar'}
              leftIcon={<Copy className="h-3.5 w-3.5" />}
              data-testid="pedido-duplicar"
            >
              Duplicar
            </Button>
          )}
          {podeEditar && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => setEditOpen(true)}
              leftIcon={<Edit3 className="h-3.5 w-3.5" />}
              data-testid="pedido-editar"
            >
              Editar
            </Button>
          )}
          {data?.status === 'RASCUNHO' && (
            <Button
              data-testid="pedido-page-enviar-omie"
              onClick={enviarOmie}
              loading={busy === 'enviar'}
              leftIcon={<Send className="h-3.5 w-3.5" />}
            >
              Enviar pro OMIE
            </Button>
          )}
          {data &&
            ['ENVIADO_OMIE', 'PAGO', 'EM_SEPARACAO', 'ENVIADO'].includes(data.status) && (
              <Button
                data-testid="pedido-page-avancar"
                onClick={avancar}
                loading={busy === 'avancar'}
                rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
              >
                Avançar status
              </Button>
            )}
          {data && data.status !== 'CANCELADO' && data.status !== 'ENTREGUE' && (
            <Button
              variant="danger"
              size="sm"
              data-testid="pedido-page-cancelar"
              onClick={() => setCancelOpen(true)}
              leftIcon={<XCircle className="h-3.5 w-3.5" />}
            >
              Cancelar
            </Button>
          )}
        </div>
      }
    >
      <StateView loading={loading && !data} error={error} onRetry={refetch}>
        {data && (
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Coluna principal — timeline + itens */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              {/* Header card com total + status */}
              <Card variant="outline" padding="md" className="bg-bg-alt">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted mb-1">
                      Total do pedido
                    </div>
                    <div className="text-4xl font-bold text-text tracking-tight tabular">
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
                      {data.condicaoPagamento && (
                        <Badge variant="outline" size="sm">
                          {data.condicaoPagamento}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-muted tabular">
                    {data.subtotal !== undefined && (
                      <div>Subtotal: {fmtBRL(data.subtotal)}</div>
                    )}
                    {data.descontoGeral !== undefined && data.descontoGeral > 0 && (
                      <div>Desconto geral: {data.descontoGeral}%</div>
                    )}
                    {data.descontoTotal !== undefined && data.descontoTotal > 0 && (
                      <div>Desconto: {fmtBRL(data.descontoTotal)}</div>
                    )}
                  </div>
                </div>
              </Card>

              {/* Timeline */}
              {data.status !== 'CANCELADO' && <StatusTimeline pedido={data} />}
              {data.status === 'CANCELADO' && <CanceledNote pedido={data} />}

              {/* Itens */}
              {data.itens && data.itens.length > 0 && (
                <section>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                    Itens ({data.itens.length})
                  </h4>
                  <Card padding="none" className="overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-bg-alt">
                          <Th>Produto</Th>
                          <Th align="right">Qt</Th>
                          <Th align="right">Unit</Th>
                          <Th align="right">% desc</Th>
                          <Th align="right">Total</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.itens.map((it) => (
                          <tr key={it.id} className="border-b border-border last:border-b-0">
                            <td className="px-3 py-2.5">
                              <div className="text-sm text-text font-medium">
                                {it.produto?.nome ?? '—'}
                              </div>
                              {it.produto?.sku && (
                                <div className="text-[10px] text-muted tabular">
                                  SKU {it.produto.sku}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right text-sm text-text tabular">
                              {it.quantidade}
                            </td>
                            <td className="px-3 py-2.5 text-right text-sm text-text-subtle tabular">
                              {fmtBRL(it.precoUnitario)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-sm text-text-subtle tabular">
                              {it.desconto > 0 ? `${it.desconto}%` : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right text-sm font-semibold text-text tabular">
                              {fmtBRL(it.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-bg-alt border-t-2 border-primary/30">
                          <td colSpan={4} className="px-3 py-2.5 text-right text-sm font-semibold text-text">
                            Total
                          </td>
                          <td className="px-3 py-2.5 text-right text-md font-bold text-primary tabular">
                            {fmtBRL(data.total)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </Card>
                </section>
              )}

              {(data.observacao || data.observacoes) && (
                <section>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                    Observação
                  </h4>
                  <Card variant="outline" padding="md">
                    <p className="text-sm text-text-subtle leading-relaxed whitespace-pre-wrap m-0">
                      {data.observacao ?? data.observacoes}
                    </p>
                  </Card>
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

            {/* Coluna lateral — info do cliente, rep, datas */}
            <div className="flex flex-col gap-4">
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                  Cliente
                </h4>
                <Card variant="outline" padding="md">
                  {data.cliente ? (
                    <div className="flex items-center gap-3">
                      <Avatar name={data.cliente.nome} size="lg" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-text truncate">
                          <Link
                            to={`/clientes/${data.cliente.id}`}
                            className="hover:text-primary"
                          >
                            {data.cliente.nome}
                          </Link>
                        </div>
                        {data.cliente.cnpj && (
                          <div className="text-[11px] text-muted tabular">
                            {data.cliente.cnpj}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-light italic text-sm">Sem cliente</span>
                  )}
                </Card>
              </section>

              {data.representante && (
                <section>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                    Representante
                  </h4>
                  <Card variant="outline" padding="md">
                    <div className="flex items-center gap-2">
                      <Avatar name={data.representante.nome} size="sm" />
                      <span className="text-sm text-text truncate">
                        {data.representante.nome}
                      </span>
                    </div>
                  </Card>
                </section>
              )}

              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                  Detalhes
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  <InfoCell icon={<Calendar />} label="Criado em" value={fmtDateTime(data.criadoEm)} />
                  {data.numeroOmie && (
                    <InfoCell icon={<Hash />} label="OMIE" value={data.numeroOmie} mono />
                  )}
                  {data.enviadoOmieEm && (
                    <InfoCell
                      icon={<Send />}
                      label="Enviado ao OMIE"
                      value={fmtDateTime(data.enviadoOmieEm)}
                    />
                  )}
                  <InfoCell
                    icon={<User />}
                    label="Forma pagto"
                    value={data.formaPagamento ?? '—'}
                  />
                </div>
              </section>

              <section>
                <button
                  type="button"
                  onClick={() => navigate('/pedidos')}
                  className="text-xs text-muted hover:text-text"
                >
                  ← Ver lista de pedidos
                </button>
              </section>
            </div>
          </div>
        )}
      </StateView>

      {/* Edit — reusa NovoPedidoDialog em modo edição (PATCH com itens) */}
      {editOpen && data && inicialDuplicar && data.cliente && (
        <NovoPedidoDialog
          open
          editandoPedidoId={data.id}
          clientePreSelecionado={{
            id: data.cliente.id,
            nome: data.cliente.nome,
            cnpj: data.cliente.cnpj ?? null,
          }}
          inicial={inicialDuplicar}
          onClose={() => setEditOpen(false)}
          onCreated={() => {
            setEditOpen(false);
            refetch();
          }}
        />
      )}

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
              data-testid="pedido-page-confirmar-cancelar"
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
    </PageLayout>
  );
}

// ─── Helpers locais ────────────────────────────────────────────

function Th({ children, align }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function StatusTimeline({ pedido }: { pedido: PedidoDetail }) {
  const currentIdx = FLOW_STEPS.indexOf(pedido.status);
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
      <Card variant="outline" padding="md">
        <ol className="flex flex-col gap-0">
          {FLOW_STEPS.map((step, idx) => {
            const Icon = STATUS_ICON[step];
            const isDone = currentIdx > idx;
            const isCurrent = currentIdx === idx;
            const isFuture = currentIdx < idx;
            const dateField = stepDate(pedido, step);

            return (
              <li key={step} className="flex items-start gap-3 group relative">
                {idx < FLOW_STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute left-[15px] top-8 bottom-0 w-px',
                      isDone ? 'bg-success' : 'bg-border',
                    )}
                  />
                )}
                <div
                  className={cn(
                    'relative flex h-8 w-8 items-center justify-center rounded-full border-2 shrink-0 z-10',
                    isDone && 'bg-success border-success text-bg',
                    isCurrent && 'bg-primary border-primary text-primary-contrast shadow-ring',
                    isFuture && 'bg-bg border-border text-muted-light',
                  )}
                >
                  {isDone ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                </div>
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
                    <span className="text-[11px] text-muted tabular">
                      {fmtDateTime(dateField)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
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
          <span className="text-[11px] text-muted tabular">
            {fmtDateTime(pedido.canceladoEm)}
          </span>
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
  const isEmpty = !value || value === '—';
  return (
    <div className="rounded-md border border-border bg-bg-alt px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted mb-1 [&>svg]:h-3 [&>svg]:w-3">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          'text-sm',
          isEmpty ? 'text-muted-light italic' : 'text-text',
          mono && 'tabular',
        )}
      >
        {value ?? '—'}
      </div>
    </div>
  );
}
