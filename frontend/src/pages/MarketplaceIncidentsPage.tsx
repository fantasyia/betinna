import { useMemo, useState } from 'react';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar } from '@/components/FilterBar';
import { Dialog } from '@/components/ui';
import { Select } from '@/components/FormField';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import { formatMoeda as fmtBRL } from '@/lib/masks';
import { cn } from '@/lib/cn';

// Layout do badge legado (sem cor) — cor entra por inline style color-mix.
const BADGE_CLS =
  'inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] border';
function badgeStyle(color: string): React.CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    color,
    borderColor: `color-mix(in srgb, ${color} 19%, transparent)`,
  };
}

// btnSecondary legado traduzido.
const BTN_SECONDARY_CLS =
  'bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]';
// card legado traduzido.
const CARD_CLS = 'bg-surface border border-border rounded-[10px] p-6';

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
  AGUARDANDO_VENDEDOR: 'var(--danger)',
  AGUARDANDO_COMPRADOR: 'var(--warning)',
  EM_MEDIACAO: '#7c3aed',
  RESOLVIDO: 'var(--success)',
  EXPIRADO: 'var(--muted)',
  CANCELADO: 'var(--muted)',
};

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
        <span className={BADGE_CLS} style={badgeStyle(CANAL_COLOR[i.canal])}>
          {CANAL_LABEL[i.canal]}
        </span>
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
          <div>{i.cliente?.nome ?? <em className="text-muted">—</em>}</div>
          {i.externalId && (
            <div className="text-[11px] text-muted">ID {i.externalId}</div>
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
        const color = h < 0 ? 'var(--danger)' : h <= 24 ? 'var(--warning)' : 'var(--muted)';
        return (
          <span className="text-[13px] font-medium" style={{ color }}>
            {h < 0 ? `${-h}h vencido` : `${h}h`}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (i) => (
        <span className={BADGE_CLS} style={badgeStyle(STATUS_COLOR[i.status])}>
          {STATUS_LABEL[i.status]}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (i) => (
        <button
          type="button"
          data-testid={`inc-open-${i.id}`}
          onClick={() => setSelected(i.id)}
          className={cn(BTN_SECONDARY_CLS, 'px-[0.625rem] py-1 text-[12px]')}
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-4">
          <StatBox label="Total" value={String(resumo.total)} />
          <StatBox
            label="Aguardando vendedor"
            value={String(resumo.aguardandoVendedor)}
            color="var(--danger)"
          />
          <StatBox
            label="Em mediação"
            value={String(resumo.emMediacao)}
            color="#7c3aed"
          />
          <StatBox
            label="Prazo urgente"
            value={String(resumo.prazoUrgente)}
            color="var(--warning)"
          />
        </div>
      )}

      <div className={CARD_CLS}>
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
  color = 'var(--text)',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className={cn(CARD_CLS, 'p-3')}>
      <div className="text-[11px] text-muted font-semibold uppercase tracking-[0.3px]">
        {label}
      </div>
      <div className="text-[24px] font-bold mt-1" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function IncidentDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error, refetch } = useApiQuery<Incident>(`/marketplace/incidentes/${id}`);

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Incidente"
      footer={
        <button type="button" onClick={onClose} className={BTN_SECONDARY_CLS}>
          Fechar
        </button>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div>
            <header className="flex gap-2 flex-wrap mb-4">
              <span className={BADGE_CLS} style={badgeStyle(CANAL_COLOR[data.canal])}>
                {CANAL_LABEL[data.canal]}
              </span>
              <span className={BADGE_CLS} style={badgeStyle('var(--muted)')}>
                {TIPO_LABEL[data.tipo]}
              </span>
              <span className={BADGE_CLS} style={badgeStyle(STATUS_COLOR[data.status])}>
                {STATUS_LABEL[data.status]}
              </span>
            </header>

            <dl className="grid grid-cols-2 gap-3 text-[14px]">
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
              <div className="mt-4">
                <h3 className="m-0 text-[12px] text-muted uppercase tracking-[0.3px]">
                  Motivo
                </h3>
                <p className="mt-1 p-3 bg-bg-alt border border-border rounded-md whitespace-pre-wrap">
                  {data.motivo}
                </p>
              </div>
            )}

            {data.conversation?.id && (
              <p className="text-[13px] mt-4">
                💬 Conversa vinculada:{' '}
                <a href={`/inbox?conv=${data.conversation.id}`} className="text-primary">
                  abrir no Inbox →
                </a>
              </p>
            )}

            <p className="text-[12px] text-muted mt-4 leading-[1.5]">
              <strong>Nota:</strong> ações específicas (responder, aceitar oferta, abrir disputa)
              dependem do marketplace. Use a Inbox vinculada quando aplicável, ou o Seller Center
              do marketplace correspondente. Ações via API serão habilitadas em fases futuras.
            </p>
          </div>
        )}
      </StateView>
    </Dialog>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-muted mb-0.5 tracking-[0.3px] font-semibold">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
