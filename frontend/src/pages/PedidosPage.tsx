import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { Select, FormField, Textarea } from '@/components/FormField';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

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
}

const STATUS_COLOR: Record<PedidoStatus, string> = {
  RASCUNHO: colors.muted,
  AGUARDANDO_APROVACAO: colors.warning,
  ENVIADO_OMIE: '#0891b2',
  PAGO: colors.success,
  EM_SEPARACAO: '#7c3aed',
  ENVIADO: '#0284c7',
  ENTREGUE: colors.success,
  CANCELADO: colors.danger,
};

const STATUS_LABEL: Record<PedidoStatus, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  ENVIADO_OMIE: 'Enviado OMIE',
  PAGO: 'Pago',
  EM_SEPARACAO: 'Em separação',
  ENVIADO: 'Enviado',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

export default function PedidosPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) qs.set('search', search.trim());
    if (status) qs.set('status', status);
    return `/pedidos?${qs.toString()}`;
  }, [page, search, status]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Pedido>>(listPath);

  const columns: Column<Pedido>[] = [
    {
      key: 'numero',
      header: 'Pedido',
      render: (p) => (
        <div>
          <strong>#{p.numero}</strong>
          {p.numeroOmie && (
            <div style={{ fontSize: 11, color: colors.muted }}>OMIE {p.numeroOmie}</div>
          )}
        </div>
      ),
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (p) => p.cliente?.nome ?? <em style={{ color: colors.muted }}>—</em>,
    },
    {
      key: 'rep',
      header: 'Rep',
      render: (p) => p.representante?.nome ?? <em style={{ color: colors.muted }}>—</em>,
    },
    {
      key: 'total',
      header: 'Total',
      render: (p) => <strong>{fmtBRL(p.total)}</strong>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <span style={badge(STATUS_COLOR[p.status])}>{STATUS_LABEL[p.status]}</span>
      ),
    },
    {
      key: 'data',
      header: 'Data',
      render: (p) => fmtDate(p.criadoEm),
    },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <button
          type="button"
          data-testid={`pedido-open-${p.id}`}
          onClick={() => setSelected(p.id)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
        >
          Abrir
        </button>
      ),
    },
  ];

  return (
    <PageLayout title="Pedidos">
      <div style={card}>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Cliente, número…"
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
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhum pedido encontrado."
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(p) => p.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      {selected && (
        <PedidoDetailModal
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

// ─── Modal de detalhe ───────────────────────────────────────────────────

function PedidoDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, loading, error, refetch } = useApiQuery<PedidoDetail>(`/pedidos/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function callAction(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha na operação');
      refetch();
    } finally {
      setBusy(null);
    }
  }

  const enviarOmie = () =>
    callAction('enviar', () => api.post(`/pedidos/${id}/enviar-omie`));
  const avancar = () =>
    callAction('avancar', () => api.post(`/pedidos/${id}/avancar-status`));

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelMotivo, setCancelMotivo] = useState('');
  const doCancel = () =>
    callAction('cancelar', () =>
      api.post(`/pedidos/${id}/cancelar`, cancelMotivo.trim() ? { motivo: cancelMotivo.trim() } : {}),
    );

  return (
    <Modal
      open
      onClose={onClose}
      width={680}
      title={data ? `Pedido #${data.numero}` : 'Pedido'}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Fechar
          </button>
          {data && data.status === 'RASCUNHO' && (
            <button
              type="button"
              data-testid="pedido-enviar-omie"
              disabled={busy !== null}
              onClick={enviarOmie}
              style={btn}
            >
              {busy === 'enviar' ? 'Enviando…' : 'Enviar pro OMIE'}
            </button>
          )}
          {data &&
            ['ENVIADO_OMIE', 'PAGO', 'EM_SEPARACAO', 'ENVIADO'].includes(data.status) && (
              <button
                type="button"
                data-testid="pedido-avancar"
                disabled={busy !== null}
                onClick={avancar}
                style={btn}
              >
                {busy === 'avancar' ? 'Avançando…' : 'Avançar status'}
              </button>
            )}
          {data && data.status !== 'CANCELADO' && data.status !== 'ENTREGUE' && (
            <button
              type="button"
              data-testid="pedido-cancelar"
              disabled={busy !== null}
              onClick={() => setCancelOpen(true)}
              style={btnDanger}
            >
              Cancelar pedido
            </button>
          )}
        </>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div>
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                marginBottom: '1rem',
              }}
            >
              <span style={badge(STATUS_COLOR[data.status])}>{STATUS_LABEL[data.status]}</span>
              <span style={{ color: colors.muted, fontSize: 13 }}>
                Criado em {fmtDate(data.criadoEm)}
              </span>
            </div>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.75rem',
                fontSize: 14,
              }}
            >
              <Info label="Cliente">{data.cliente?.nome ?? '—'}</Info>
              <Info label="Representante">{data.representante?.nome ?? '—'}</Info>
              <Info label="Subtotal">{data.subtotal !== undefined ? fmtBRL(data.subtotal) : '—'}</Info>
              <Info label="Desconto">
                {data.descontoTotal !== undefined ? fmtBRL(data.descontoTotal) : '—'}
              </Info>
              <Info label="Total">
                <strong>{fmtBRL(data.total)}</strong>
              </Info>
              <Info label="Pagamento">{data.formaPagamento ?? '—'}</Info>
              {data.numeroOmie && <Info label="Número OMIE">{data.numeroOmie}</Info>}
              {data.enviadoOmieEm && (
                <Info label="Enviado OMIE">{fmtDate(data.enviadoOmieEm)}</Info>
              )}
            </dl>

            {data.itens && data.itens.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <h3 style={{ fontSize: 14, marginBottom: '0.5rem' }}>Itens</h3>
                <Table
                  data={data.itens}
                  rowKey={(i) => i.id}
                  columns={[
                    {
                      key: 'produto',
                      header: 'Produto',
                      render: (i) => i.produto?.nome ?? '—',
                    },
                    { key: 'qt', header: 'Qt', render: (i) => i.quantidade },
                    {
                      key: 'unit',
                      header: 'Unit',
                      render: (i) => fmtBRL(i.precoUnitario),
                    },
                    { key: 'desc', header: 'Desc', render: (i) => fmtBRL(i.desconto) },
                    {
                      key: 'tot',
                      header: 'Total',
                      render: (i) => <strong>{fmtBRL(i.total)}</strong>,
                    },
                  ]}
                />
              </div>
            )}

            {data.observacao && (
              <div style={{ marginTop: '1rem' }}>
                <h3 style={{ fontSize: 14, marginBottom: '0.25rem' }}>Observação</h3>
                <p style={{ fontSize: 14, color: colors.muted }}>{data.observacao}</p>
              </div>
            )}

            {actionError && (
              <div
                data-testid="action-error"
                style={{
                  ...card,
                  borderColor: colors.danger,
                  color: colors.danger,
                  padding: '0.5rem 0.75rem',
                  marginTop: '0.75rem',
                }}
              >
                {actionError}
              </div>
            )}
          </div>
        )}
      </StateView>

      {/* Submodal cancelar */}
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancelar pedido"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              style={btnSecondary}
            >
              Voltar
            </button>
            <button
              type="button"
              data-testid="pedido-confirmar-cancelar"
              disabled={busy !== null}
              onClick={() => {
                setCancelOpen(false);
                void doCancel();
              }}
              style={btnDanger}
            >
              Confirmar cancelamento
            </button>
          </>
        }
      >
        <FormField label="Motivo (opcional)" htmlFor="cancel-motivo">
          <Textarea
            id="cancel-motivo"
            value={cancelMotivo}
            onChange={(e) => setCancelMotivo(e.target.value)}
            placeholder="Ex: cliente desistiu, estoque indisponível…"
          />
        </FormField>
      </Modal>
    </Modal>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          color: colors.muted,
          marginBottom: 2,
          letterSpacing: 0.3,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
