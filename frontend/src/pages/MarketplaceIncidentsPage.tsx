import { useMemo, useState } from 'react';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar } from '@/components/FilterBar';
import { Dialog, Tabs } from '@/components/ui';
import { useSearchParams } from 'react-router-dom';
import {
  ConversasMarketplace,
  type GrupoMarketplace,
} from '@/pages/marketplace/ConversasMarketplace';
import { Select } from '@/components/FormField';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import { formatMoeda as fmtBRL } from '@/lib/masks';
import { cn } from '@/lib/cn';
import {
  CampoResposta,
  hora,
  useMensagensMkt,
} from '@/pages/marketplace/RespostaMarketplace';

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

/** O que o backend junta da reclamação no ML (`metadata.ml_detalhe`, 29/09). */
interface DetalheML {
  titulo: string | null;
  descricao: string | null;
  problema: string | null;
  responsavel: string | null;
  prazo: string | null;
  motivo: string | null;
  afetaReputacao: string | null;
  acoesVendedor: string[];
  pedido: {
    id: string;
    total: number | null;
    itemId: string | null;
    titulo: string | null;
    variacao: string | null;
    sku: string | null;
    quantidade: number | null;
  } | null;
}

interface Incident {
  id: string;
  externalId?: string | null;
  canal: Canal;
  tipo: Tipo;
  status: Status;
  cliente?: { id: string; nome: string } | null;
  pedidoExternoId?: string | null;
  // Decimal do Prisma chega como string no JSON.
  valor?: number | string | null;
  valorReembolso?: number | string | null;
  motivo?: string | null;
  prazoResposta?: string | null;
  resolvidoEm?: string | null;
  abertoEm: string;
  atualizadoEm: string;
  conversations?: Array<{ id: string }>;
  metadata?: { ml_detalhe?: DetalheML } & Record<string, unknown>;
}

const RESPONSAVEL_LABEL: Record<string, string> = {
  respondent: 'Você (vendedor)',
  complainant: 'Comprador',
  mediator: 'Mercado Livre (mediação)',
};

const REPUTACAO_LABEL: Record<string, string> = {
  not_affected: 'Não afeta sua reputação',
  affected: 'Afeta sua reputação',
};

function valorNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Anúncio no ML a partir do id (MLB123 → MLB-123). */
function linkAnuncio(itemId: string): string {
  return `https://produto.mercadolivre.com.br/${itemId.replace(/^([A-Z]+)(\d+)$/, '$1-$2')}`;
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

type AbaMarketplace = GrupoMarketplace | 'reclamacoes';
const ABAS: AbaMarketplace[] = ['pre_venda', 'pos_venda', 'reclamacoes'];

interface ResumoCanal {
  canal: string;
  preVenda: number;
  posVenda: number;
  reclamacoes: number;
}

/**
 * Aba Marketplaces (Léo, 29/09): três abas com contador — Pré-venda (perguntas
 * nos anúncios), Pós-venda (mensagens de quem comprou) e Reclamações e mediações
 * (a tabela de incidentes que já existia). A aba fica na URL (?aba=).
 */
export default function MarketplaceIncidentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const abaUrl = searchParams.get('aba') as AbaMarketplace | null;
  const aba: AbaMarketplace = abaUrl && ABAS.includes(abaUrl) ? abaUrl : 'pre_venda';
  const trocarAba = (v: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('aba', v);
    setSearchParams(next, { replace: true });
  };
  const { data: resumoMkt } = useApiQuery<ResumoCanal[]>('/inbox/marketplace/resumo');
  const total = (k: keyof Omit<ResumoCanal, 'canal'>) =>
    (resumoMkt ?? []).reduce((s, r) => s + r[k], 0);

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
      key: 'produto',
      header: 'Produto / motivo',
      render: (i) => {
        const d = i.metadata?.ml_detalhe;
        return (
          <div className="max-w-[340px]">
            <div className="truncate">
              {d?.pedido?.titulo ?? i.cliente?.nome ?? <em className="text-muted">—</em>}
            </div>
            {d?.pedido?.variacao && (
              <div className="text-[11px] text-muted truncate">{d.pedido.variacao}</div>
            )}
            {(d?.titulo || i.motivo) && (
              <div className="text-[12px] text-muted truncate">{d?.titulo ?? i.motivo}</div>
            )}
            {i.externalId && <div className="text-[11px] text-muted">ID {i.externalId}</div>}
          </div>
        );
      },
    },
    {
      key: 'valor',
      header: 'Valor',
      render: (i) => {
        const v = valorNum(i.valor);
        return v !== null ? fmtBRL(v) : '—';
      },
    },
    {
      key: 'prazo',
      header: 'Prazo',
      render: (i) => {
        if (['RESOLVIDO', 'CANCELADO', 'EXPIRADO'].includes(i.status)) return '—';
        const d = i.metadata?.ml_detalhe;
        if (!i.prazoResposta) {
          // prazo de outra parte (ex.: comprador devolver) — informativo, sem alarme
          if (d?.prazo && d.responsavel && d.responsavel !== 'respondent') {
            return (
              <span className="text-[12px] text-muted">
                {RESPONSAVEL_LABEL[d.responsavel] ?? d.responsavel} até {hora(d.prazo)}
              </span>
            );
          }
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
      description="Perguntas de pré-venda, mensagens de pós-venda e reclamações vindas dos marketplaces."
    >
      <AtendimentoTabs />
      <div className="mb-4" data-testid="mkt-abas">
        <Tabs
          items={[
            { value: 'pre_venda', label: 'Pré-venda', count: total('preVenda') },
            { value: 'pos_venda', label: 'Pós-venda', count: total('posVenda') },
            { value: 'reclamacoes', label: 'Reclamações e mediações', count: total('reclamacoes') },
          ]}
          value={aba}
          onChange={trocarAba}
        />
      </div>

      {aba !== 'reclamacoes' ? (
        <div className={CARD_CLS + ' !p-0 overflow-hidden'}>
          <ConversasMarketplace grupo={aba} />
        </div>
      ) : (
      <>
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
      </>
      )}

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
  const d = data?.metadata?.ml_detalhe;
  const convId = data?.conversations?.[0]?.id ?? null;
  const podeMandar = (d?.acoesVendedor ?? []).some((a) => a.startsWith('send_message_to_'));
  const encerrado = data ? ['RESOLVIDO', 'CANCELADO', 'EXPIRADO'].includes(data.status) : false;
  const valor = valorNum(data?.valor);
  const reembolso = valorNum(data?.valorReembolso);

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={d?.titulo ?? `${data ? TIPO_LABEL[data.tipo] : 'Reclamação'}`}
      footer={
        <button type="button" onClick={onClose} className={BTN_SECONDARY_CLS}>
          Fechar
        </button>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div data-testid="inc-detalhe">
            <header className="flex gap-2 flex-wrap mb-3">
              <span className={BADGE_CLS} style={badgeStyle(CANAL_COLOR[data.canal])}>
                {CANAL_LABEL[data.canal]}
              </span>
              <span className={BADGE_CLS} style={badgeStyle('var(--muted)')}>
                {TIPO_LABEL[data.tipo]}
              </span>
              <span className={BADGE_CLS} style={badgeStyle(STATUS_COLOR[data.status])}>
                {STATUS_LABEL[data.status]}
              </span>
              {d?.afetaReputacao && (
                <span
                  className={BADGE_CLS}
                  style={badgeStyle(
                    d.afetaReputacao === 'not_affected' ? 'var(--success)' : 'var(--danger)',
                  )}
                >
                  {REPUTACAO_LABEL[d.afetaReputacao] ?? d.afetaReputacao}
                </span>
              )}
            </header>

            {(d?.descricao || d?.responsavel) && (
              <div className="mb-4 p-3 bg-bg-alt border border-border rounded-md text-[14px]">
                {d?.descricao && <p className="m-0 whitespace-pre-wrap">{d.descricao}</p>}
                {d?.responsavel && !encerrado && (
                  <p className="m-0 mt-2 text-[13px]">
                    <strong>Próxima ação:</strong>{' '}
                    {RESPONSAVEL_LABEL[d.responsavel] ?? d.responsavel}
                    {d.prazo && <> · até {fmtDate(d.prazo)}</>}
                    {d.responsavel !== 'respondent' && (
                      <span className="text-muted"> — você não precisa fazer nada agora.</span>
                    )}
                  </p>
                )}
              </div>
            )}

            <dl className="grid grid-cols-2 gap-3 text-[14px]">
              {d?.pedido?.titulo && (
                <div className="col-span-2">
                  <Info label="Produto">
                    {d.pedido.itemId ? (
                      <a
                        href={linkAnuncio(d.pedido.itemId)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary"
                      >
                        {d.pedido.titulo}
                      </a>
                    ) : (
                      d.pedido.titulo
                    )}
                    {(d.pedido.variacao || d.pedido.sku) && (
                      <div className="text-[12px] text-muted">
                        {[d.pedido.variacao, d.pedido.sku && `SKU ${d.pedido.sku}`]
                          .filter(Boolean)
                          .join(' · ')}
                        {d.pedido.quantidade ? ` · ${d.pedido.quantidade} un.` : ''}
                      </div>
                    )}
                  </Info>
                </div>
              )}
              <Info label="Motivo do comprador">{data.motivo ?? d?.problema ?? '—'}</Info>
              <Info label="Valor da venda">{valor !== null ? fmtBRL(valor) : '—'}</Info>
              {reembolso !== null && <Info label="Reembolso">{fmtBRL(reembolso)}</Info>}
              <Info label="Pedido">
                {data.pedidoExternoId ? (
                  <a
                    href={`https://www.mercadolivre.com.br/vendas/${data.pedidoExternoId}/detalhe`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary"
                  >
                    {data.pedidoExternoId} ↗
                  </a>
                ) : (
                  '—'
                )}
              </Info>
              <Info label="Reclamação">{data.externalId ?? '—'}</Info>
              <Info label="Entrou no app">{fmtDate(data.abertoEm)}</Info>
              {data.resolvidoEm && <Info label="Resolvido">{fmtDate(data.resolvidoEm)}</Info>}
            </dl>

            {convId && (
              <MensagensReclamacao
                conversationId={convId}
                podeMandar={podeMandar && !encerrado}
                onEnviada={refetch}
              />
            )}
          </div>
        )}
      </StateView>
    </Dialog>
  );
}

const PAPEL_MSG: Record<string, string> = {
  mediator: 'Mercado Livre',
  complainant: 'Comprador',
  respondent: 'Você',
};

/** Mensagens da reclamação e resposta direto daqui (vai pro ML pelo mesmo caminho da Inbox). */
function MensagensReclamacao({
  conversationId,
  podeMandar,
  onEnviada,
}: {
  conversationId: string;
  podeMandar: boolean;
  onEnviada: () => void;
}) {
  const { lista, refetch } = useMensagensMkt(conversationId);
  // O evento "sistêmico" (resumo técnico da claim) não é conversa.
  const msgs = lista.filter((m) => m.tipo !== 'SYSTEM');
  return (
    <div className="mt-5">
      <h3 className="m-0 mb-2 text-[12px] text-muted uppercase tracking-[0.3px]">Mensagens</h3>
      {msgs.length === 0 ? (
        <p className="text-[13px] text-muted m-0">Nenhuma mensagem nesta reclamação.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-2 max-h-[320px] overflow-y-auto">
          {msgs.map((m) => (
            <li
              key={m.id}
              className={cn(
                'rounded-md border px-3 py-2 text-[13px]',
                m.direction === 'OUTBOUND'
                  ? 'border-border bg-surface ml-8'
                  : 'border-border bg-bg-alt mr-8',
                m.status === 'FAILED' && 'border-danger',
              )}
            >
              <div className="flex justify-between gap-2 text-[11px] text-muted mb-0.5">
                <span>
                  {m.direction === 'OUTBOUND'
                    ? m.status === 'FAILED'
                      ? '⚠ Você — não enviada'
                      : 'Você'
                    : (PAPEL_MSG[m.meta?.ml_sender_role ?? ''] ?? 'Comprador')}
                </span>
                <span>{hora(m.criadoEm)}</span>
              </div>
              <div className="whitespace-pre-wrap">{m.conteudo}</div>
            </li>
          ))}
        </ul>
      )}
      {podeMandar ? (
        <CampoResposta
          conversationId={conversationId}
          testId="inc-msg"
          placeholder="Mensagem pro Mercado Livre / comprador…"
          onEnviada={() => {
            refetch();
            onEnviada();
          }}
        />
      ) : (
        <p data-testid="inc-sem-acao" className="text-[12px] text-muted mt-2 mb-0">
          O Mercado Livre não libera mensagem sua nesta etapa — quando precisar de você, o campo
          de resposta aparece aqui.
        </p>
      )}
    </div>
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
