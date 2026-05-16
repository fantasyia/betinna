import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Select, Textarea } from '@/components/FormField';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

type AprovacaoStatus = 'PENDENTE' | 'APROVADA' | 'REJEITADA';

interface Aprovacao {
  id: string;
  pedidoId: string;
  descontoSolicitado: number;
  motivo: string;
  status: AprovacaoStatus;
  comentarioAprovador?: string | null;
  criadoEm: string;
  resolvidoEm?: string | null;
  representante?: { id: string; nome: string; tetoDesconto?: number };
  gerente?: { id: string; nome: string } | null;
  pedido?: {
    id: string;
    numero: string | number;
    total: number;
    cliente?: { id: string; nome: string };
  };
}

const STATUS_COLOR: Record<AprovacaoStatus, string> = {
  PENDENTE: colors.warning,
  APROVADA: colors.success,
  REJEITADA: colors.danger,
};
const STATUS_LABEL: Record<AprovacaoStatus, string> = {
  PENDENTE: 'Pendente',
  APROVADA: 'Aprovada',
  REJEITADA: 'Rejeitada',
};
const STATUS_LIST: AprovacaoStatus[] = ['PENDENTE', 'APROVADA', 'REJEITADA'];

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtPct(v: number) {
  return `${v.toFixed(2)}%`;
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

export default function AprovacoesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('PENDENTE');
  const [selected, setSelected] = useState<string | null>(null);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (status) qs.set('status', status);
    return `/aprovacoes?${qs.toString()}`;
  }, [page, status]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Aprovacao>>(listPath);

  const columns: Column<Aprovacao>[] = [
    {
      key: 'pedido',
      header: 'Pedido',
      render: (a) => (
        <div>
          <strong>#{a.pedido?.numero ?? '—'}</strong>
          <div style={{ fontSize: 11, color: colors.muted }}>
            {a.pedido?.cliente?.nome ?? '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'rep',
      header: 'Solicitante',
      render: (a) => (
        <div>
          <div>{a.representante?.nome ?? '—'}</div>
          {a.representante?.tetoDesconto !== undefined && (
            <div style={{ fontSize: 11, color: colors.muted }}>
              teto: {fmtPct(a.representante.tetoDesconto)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'desc',
      header: 'Desconto solicitado',
      render: (a) => {
        const teto = a.representante?.tetoDesconto;
        const excede = teto !== undefined ? a.descontoSolicitado - teto : null;
        return (
          <div>
            <strong style={{ color: colors.warning }}>
              {fmtPct(a.descontoSolicitado)}
            </strong>
            {excede !== null && excede > 0 && (
              <div style={{ fontSize: 11, color: colors.danger }}>
                +{fmtPct(excede)} acima do teto
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'valor',
      header: 'Valor pedido',
      render: (a) => fmtBRL(a.pedido?.total ?? 0),
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <span style={badge(STATUS_COLOR[a.status])}>{STATUS_LABEL[a.status]}</span>,
    },
    {
      key: 'data',
      header: 'Solicitado em',
      render: (a) => fmtDate(a.criadoEm),
    },
    {
      key: 'actions',
      header: '',
      render: (a) => (
        <button
          type="button"
          data-testid={`aprov-open-${a.id}`}
          onClick={() => setSelected(a.id)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
        >
          {a.status === 'PENDENTE' ? 'Decidir' : 'Ver'}
        </button>
      ),
    },
  ];

  return (
    <PageLayout title="Aprovações de desconto">
      <div style={card}>
        <FilterBar>
          <Select
            data-testid="filter-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos os status</option>
            {STATUS_LIST.map((s) => (
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
          emptyMessage={
            status === 'PENDENTE'
              ? 'Nenhuma aprovação pendente — equipe em dia!'
              : 'Nenhuma aprovação encontrada.'
          }
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(a) => a.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      {selected && (
        <AprovacaoDetailModal
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

function AprovacaoDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, loading, error, refetch } = useApiQuery<Aprovacao>(`/aprovacoes/${id}`);
  const [comentario, setComentario] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acao, setAcao] = useState<'aprovar' | 'rejeitar' | null>(null);

  async function decidir() {
    if (!acao) return;
    setBusy(true);
    setActionError(null);
    try {
      const payload = comentario.trim() ? { comentario: comentario.trim() } : {};
      await api.post(`/aprovacoes/${id}/${acao}`, payload);
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha na decisão');
      refetch();
    } finally {
      setBusy(false);
    }
  }

  const isPendente = data?.status === 'PENDENTE';
  const teto = data?.representante?.tetoDesconto;
  const excede = teto !== undefined && data ? data.descontoSolicitado - teto : null;

  return (
    <Modal
      open
      onClose={onClose}
      width={600}
      title="Aprovação de desconto"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Fechar
          </button>
          {isPendente && acao === null && (
            <>
              <button
                type="button"
                data-testid="aprov-rejeitar"
                onClick={() => setAcao('rejeitar')}
                style={btnDanger}
              >
                Rejeitar
              </button>
              <button
                type="button"
                data-testid="aprov-aprovar"
                onClick={() => setAcao('aprovar')}
                style={btn}
              >
                Aprovar
              </button>
            </>
          )}
          {isPendente && acao !== null && (
            <>
              <button type="button" onClick={() => setAcao(null)} style={btnSecondary}>
                Voltar
              </button>
              <button
                type="button"
                data-testid={`aprov-confirmar-${acao}`}
                disabled={busy}
                onClick={decidir}
                style={acao === 'aprovar' ? btn : btnDanger}
              >
                {busy
                  ? 'Aplicando…'
                  : acao === 'aprovar'
                  ? 'Confirmar aprovação'
                  : 'Confirmar rejeição'}
              </button>
            </>
          )}
        </>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div>
            <header style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
              <span style={badge(STATUS_COLOR[data.status])}>{STATUS_LABEL[data.status]}</span>
              <span style={{ color: colors.muted, fontSize: 13 }}>
                Solicitada em {fmtDate(data.criadoEm)}
              </span>
            </header>

            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: 14 }}>
              <Info label="Pedido">
                <strong>#{data.pedido?.numero ?? '—'}</strong>
                {data.pedido?.cliente?.nome && (
                  <div style={{ fontSize: 12, color: colors.muted }}>
                    Cliente: {data.pedido.cliente.nome}
                  </div>
                )}
                {data.pedido?.total !== undefined && (
                  <div style={{ fontSize: 12, color: colors.muted }}>
                    Total: {fmtBRL(data.pedido.total)}
                  </div>
                )}
              </Info>
              <Info label="Solicitante">
                {data.representante?.nome ?? '—'}
                {teto !== undefined && (
                  <div style={{ fontSize: 12, color: colors.muted }}>
                    Teto: {fmtPct(teto)}
                  </div>
                )}
              </Info>
              <Info label="Desconto solicitado">
                <strong style={{ color: colors.warning, fontSize: 18 }}>
                  {fmtPct(data.descontoSolicitado)}
                </strong>
                {excede !== null && excede > 0 && (
                  <div style={{ fontSize: 12, color: colors.danger }}>
                    +{fmtPct(excede)} acima do teto do rep
                  </div>
                )}
              </Info>
              <Info label="Gerente alocado">{data.gerente?.nome ?? '—'}</Info>
            </dl>

            <div
              style={{
                background: '#fafbfc',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: '0.75rem',
                marginTop: '1rem',
              }}
            >
              <h3 style={{ marginTop: 0, fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                Justificativa do representante
              </h3>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{data.motivo}</p>
            </div>

            {data.comentarioAprovador && (
              <div
                style={{
                  background: (data.status === 'APROVADA' ? colors.success : colors.danger) + '15',
                  border: `1px solid ${data.status === 'APROVADA' ? colors.success : colors.danger}`,
                  borderRadius: 6,
                  padding: '0.75rem',
                  marginTop: '0.75rem',
                }}
              >
                <h3
                  style={{
                    marginTop: 0,
                    fontSize: 13,
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                    color: data.status === 'APROVADA' ? colors.success : colors.danger,
                  }}
                >
                  Decisão do aprovador
                </h3>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>
                  {data.comentarioAprovador}
                </p>
                {data.resolvidoEm && (
                  <p style={{ fontSize: 11, color: colors.muted, marginTop: 4, marginBottom: 0 }}>
                    Resolvido em {fmtDate(data.resolvidoEm)}
                  </p>
                )}
              </div>
            )}

            {isPendente && acao !== null && (
              <div
                style={{
                  marginTop: '1rem',
                  paddingTop: '1rem',
                  borderTop: `1px solid ${colors.border}`,
                }}
              >
                <FormField
                  label={`Comentário ${acao === 'rejeitar' ? '(recomendado)' : '(opcional)'}`}
                  htmlFor="aprov-coment"
                  hint={
                    acao === 'rejeitar'
                      ? 'Explique pro rep por que o desconto não foi aprovado.'
                      : 'Notas pro histórico (ex: "OK por se tratar de cliente VIP").'
                  }
                >
                  <Textarea
                    id="aprov-coment"
                    data-testid="aprov-comentario-input"
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    maxLength={500}
                  />
                </FormField>
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
