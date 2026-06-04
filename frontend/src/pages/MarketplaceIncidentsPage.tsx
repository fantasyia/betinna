import { useMemo, useState } from 'react';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/FormField';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import { badge, btnSecondary, card, colors } from '@/components/styles';

type Canal =
  | 'MARKETPLACE_ML'
  | 'MARKETPLACE_SHOPEE'
  | 'MARKETPLACE_AMAZON'
  | 'MARKETPLACE_TIKTOK';

type Tipo = 'RECLAMACAO' | 'DEVOLUCAO' | 'MEDIACAO' | 'DISPUTA' | 'CANCELAMENTO';

type Status =
  | 'ABERTO'
  | 'AGUARDANDO_VENDEDOR'
  | 'AGUARDANDO_COMPRADOR'
  | 'EM_MEDIACAO'
  | 'RESOLVIDO'
  | 'EXPIRADO'
  | 'CANCELADO';

interface Incident {
  id: string;
  externalId?: string | null;
  canal: Canal;
  tipo: Tipo;
  status: Status;
  cliente?: { id: string; nome: string } | null;
  pedidoId?: string | null;
  valor?: number | null;
  valorReembolso?: number | null;
  motivo?: string | null;
  prazoResposta?: string | null;
  resolvidoEm?: string | null;
  criadoEm: string;
  atualizadoEm: string;
  conversation?: { id: string } | null;
  metadata?: Record<string, unknown>;
}

interface Resumo {
  total: number;
  aguardandoVendedor: number;
  emMediacao: number;
  prazoUrgente: number;
}

const CANAL_LABEL: Record<Canal, string> = {
  MARKETPLACE_ML: 'Mercado Livre',
  MARKETPLACE_SHOPEE: 'Shopee',
  MARKETPLACE_AMAZON: 'Amazon',
  MARKETPLACE_TIKTOK: 'TikTok Shop',
};
const CANAL_COLOR: Record<Canal, string> = {
  MARKETPLACE_ML: '#facc15',
  MARKETPLACE_SHOPEE: '#ee4d2d',
  MARKETPLACE_AMAZON: '#ff9900',
  MARKETPLACE_TIKTOK: '#000',
};

const TIPO_LABEL: Record<Tipo, string> = {
  RECLAMACAO: 'Reclamação',
  DEVOLUCAO: 'Devolução',
  MEDIACAO: 'Mediação',
  DISPUTA: 'Disputa',
  CANCELAMENTO: 'Cancelamento',
};

const STATUS_LABEL: Record<Status, string> = {
  ABERTO: 'Aberto',
  AGUARDANDO_VENDEDOR: 'Aguardando vendedor',
  AGUARDANDO_COMPRADOR: 'Aguardando comprador',
  EM_MEDIACAO: 'Em mediação',
  RESOLVIDO: 'Resolvido',
  EXPIRADO: 'Expirado',
  CANCELADO: 'Cancelado',
};
const STATUS_COLOR: Record<Status, string> = {
  ABERTO: '#0891b2',
  AGUARDANDO_VENDEDOR: colors.danger,
  AGUARDANDO_COMPRADOR: colors.warning,
  EM_MEDIACAO: '#7c3aed',
  RESOLVIDO: colors.success,
  EXPIRADO: colors.muted,
  CANCELADO: colors.muted,
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}
function hoursUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.round((dt.getTime() - Date.now()) / 3_600_000);
}

export default function MarketplaceIncidentsPage() {
  const [page, setPage] = useState(1);
  const [canal, setCanal] = useState('');
  const [tipo, setTipo] = useState('');
  const [status, setStatus] = useState('');
  const [aguardandoMim, setAguardandoMim] = useState('');
  const [prazoUrgente, setPrazoUrgente] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '30' });
    if (canal) qs.set('canal', canal);
    if (tipo) qs.set('tipo', tipo);
    if (status) qs.set('status', status);
    if (aguardandoMim) qs.set('aguardandoMim', aguardandoMim);
    if (prazoUrgente) qs.set('prazoUrgente', prazoUrgente);
    return `/marketplace/incidentes?${qs.toString()}`;
  }, [page, canal, tipo, status, aguardandoMim, prazoUrgente]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Incident>>(listPath);
  const { data: resumo } = useApiQuery<Resumo>('/marketplace/incidentes/resumo');

  const columns: Column<Incident>[] = [
    {
      key: 'canal',
      header: 'Canal',
      render: (i) => (
        <span style={badge(CANAL_COLOR[i.canal])}>{CANAL_LABEL[i.canal]}</span>
      ),
    },
    {
      key: 'tipo',
      header: 'Tipo',
      render: (i) => TIPO_LABEL[i.tipo],
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (i) => (
        <div>
          <div>{i.cliente?.nome ?? <em style={{ color: colors.muted }}>—</em>}</div>
          {i.externalId && (
            <div style={{ fontSize: 11, color: colors.muted }}>ID {i.externalId}</div>
          )}
        </div>
      ),
    },
    {
      key: 'valor',
      header: 'Valor',
      render: (i) =>
        i.valor !== null && i.valor !== undefined ? fmtBRL(i.valor) : '—',
    },
    {
      key: 'prazo',
      header: 'Prazo',
      render: (i) => {
        if (['RESOLVIDO', 'CANCELADO', 'EXPIRADO'].includes(i.status) || !i.prazoResposta) {
          return '—';
        }
        const h = hoursUntil(i.prazoResposta);
        if (h === null) return fmtDate(i.prazoResposta);
        const color = h < 0 ? colors.danger : h <= 24 ? colors.warning : colors.muted;
        return (
          <span style={{ color, fontSize: 13, fontWeight: 500 }}>
            {h < 0 ? `${-h}h vencido` : `${h}h`}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (i) => <span style={badge(STATUS_COLOR[i.status])}>{STATUS_LABEL[i.status]}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (i) => (
        <button
          type="button"
          data-testid={`inc-open-${i.id}`}
          onClick={() => setSelected(i.id)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
        >
          Abrir
        </button>
      ),
    },
  ];

  return (
    <PageLayout
      title="Atendimento — Marketplaces"
      description="Reclamações, devoluções, mediações e disputas vindas dos marketplaces."
    >
      <AtendimentoTabs />
      {resumo && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <StatBox label="Total" value={String(resumo.total)} />
          <StatBox
            label="Aguardando vendedor"
            value={String(resumo.aguardandoVendedor)}
            color={colors.danger}
          />
          <StatBox
            label="Em mediação"
            value={String(resumo.emMediacao)}
            color="#7c3aed"
          />
          <StatBox
            label="Prazo urgente"
            value={String(resumo.prazoUrgente)}
            color={colors.warning}
          />
        </div>
      )}

      <div style={card}>
        <FilterBar>
          <Select
            data-testid="filter-canal"
            value={canal}
            onChange={(e) => {
              setCanal(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos canais</option>
            {(Object.keys(CANAL_LABEL) as Canal[]).map((c) => (
              <option key={c} value={c}>
                {CANAL_LABEL[c]}
              </option>
            ))}
          </Select>
          <Select
            data-testid="filter-tipo"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos tipos</option>
            {(Object.keys(TIPO_LABEL) as Tipo[]).map((t) => (
              <option key={t} value={t}>
                {TIPO_LABEL[t]}
              </option>
            ))}
          </Select>
          <Select
            data-testid="filter-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos status</option>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            data-testid="filter-aguardando"
            value={aguardandoMim}
            onChange={(e) => {
              setAguardandoMim(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Aguardando: todos</option>
            <option value="true">Apenas aguardando vendedor</option>
          </Select>
          <Select
            data-testid="filter-prazo"
            value={prazoUrgente}
            onChange={(e) => {
              setPrazoUrgente(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Prazo: todos</option>
            <option value="true">Apenas prazo &lt; 24h</option>
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhum incidente nesse filtro — equipe em dia!"
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(i) => i.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      {selected && (
        <IncidentDetailModal id={selected} onClose={() => setSelected(null)} />
      )}
    </PageLayout>
  );
}

function StatBox({
  label,
  value,
  color = colors.text,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ ...card, padding: '0.75rem' }}>
      <div style={{ fontSize: 11, color: colors.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function IncidentDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error, refetch } = useApiQuery<Incident>(`/marketplace/incidentes/${id}`);

  return (
    <Modal
      open
      onClose={onClose}
      width={640}
      title="Incidente"
      footer={
        <button type="button" onClick={onClose} style={btnSecondary}>
          Fechar
        </button>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div>
            <header style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <span style={badge(CANAL_COLOR[data.canal])}>{CANAL_LABEL[data.canal]}</span>
              <span style={badge(colors.muted)}>{TIPO_LABEL[data.tipo]}</span>
              <span style={badge(STATUS_COLOR[data.status])}>{STATUS_LABEL[data.status]}</span>
            </header>

            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: 14 }}>
              <Info label="Cliente">{data.cliente?.nome ?? '—'}</Info>
              <Info label="External ID">{data.externalId ?? '—'}</Info>
              <Info label="Valor">
                {data.valor !== null && data.valor !== undefined ? fmtBRL(data.valor) : '—'}
              </Info>
              <Info label="Reembolso">
                {data.valorReembolso !== null && data.valorReembolso !== undefined
                  ? fmtBRL(data.valorReembolso)
                  : '—'}
              </Info>
              <Info label="Prazo resposta">{fmtDate(data.prazoResposta)}</Info>
              <Info label="Criado">{fmtDate(data.criadoEm)}</Info>
              {data.resolvidoEm && <Info label="Resolvido">{fmtDate(data.resolvidoEm)}</Info>}
              {data.pedidoId && <Info label="Pedido">{data.pedidoId}</Info>}
            </dl>

            {data.motivo && (
              <div style={{ marginTop: '1rem' }}>
                <h3
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: colors.muted,
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                  }}
                >
                  Motivo
                </h3>
                <p
                  style={{
                    marginTop: 4,
                    padding: '0.75rem',
                    background: colors.bgAlt,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {data.motivo}
                </p>
              </div>
            )}

            {data.conversation?.id && (
              <p style={{ fontSize: 13, marginTop: '1rem' }}>
                💬 Conversa vinculada:{' '}
                <a href={`/inbox?conv=${data.conversation.id}`} style={{ color: colors.primary }}>
                  abrir no Inbox →
                </a>
              </p>
            )}

            <p style={{ fontSize: 12, color: colors.muted, marginTop: '1rem', lineHeight: 1.5 }}>
              <strong>Nota:</strong> ações específicas (responder, aceitar oferta, abrir disputa)
              dependem do marketplace. Use a Inbox vinculada quando aplicável, ou o Seller Center
              do marketplace correspondente. Ações via API serão habilitadas em fases futuras.
            </p>
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
