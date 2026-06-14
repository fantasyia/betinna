import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Percent,
  User,
  FileText,
  TrendingUp,
  Receipt,
  Ban,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { VendasTabs } from '@/components/VendasTabs';
import { StateView } from '@/components/StateView';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatMoeda as fmtBRL, formatPercent } from '@/lib/masks';

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

const STATUS_VARIANT: Record<AprovacaoStatus, 'warning' | 'success' | 'danger'> = {
  PENDENTE: 'warning',
  APROVADA: 'success',
  REJEITADA: 'danger',
};

const STATUS_LABEL: Record<AprovacaoStatus, string> = {
  PENDENTE: 'Pendente',
  APROVADA: 'Aprovada',
  REJEITADA: 'Rejeitada',
};

const STATUS_ICON: Record<AprovacaoStatus, typeof Clock> = {
  PENDENTE: Clock,
  APROVADA: CheckCircle2,
  REJEITADA: XCircle,
};

function fmtPct(v: number) {
  return formatPercent(v, 2);
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

type AprovacaoTab = 'descontos' | 'cancelamentos';

export default function AprovacoesPage() {
  const [tab, setTab] = useState<AprovacaoTab>('descontos');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('PENDENTE');
  const [selected, setSelected] = useState<string | null>(null);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (status) qs.set('status', status);
    return `/aprovacoes?${qs.toString()}`;
  }, [page, status]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Aprovacao>>(
    listPath,
  );

  const counts = pageResp?.data?.reduce(
    (acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    },
    { PENDENTE: 0, APROVADA: 0, REJEITADA: 0 } as Record<AprovacaoStatus, number>,
  );

  return (
    <PageLayout
      title="Aprovações"
      description={
        tab === 'descontos'
          ? status === 'PENDENTE'
            ? 'Decisões aguardando sua aprovação.'
            : 'Histórico de aprovações de desconto acima do teto do representante.'
          : 'Solicitações de cancelamento de pedido feitas por representante/gerente.'
      }
    >
      <VendasTabs />

      {/* Tab toggle: Descontos | Cancelamentos */}
      <div className="mb-3 inline-flex items-center gap-1 p-1 bg-bg-alt rounded-md border border-border">
        <button
          type="button"
          data-testid="tab-descontos"
          onClick={() => {
            setTab('descontos');
            setPage(1);
          }}
          className={cn(
            'inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium transition-colors',
            tab === 'descontos'
              ? 'bg-surface text-text shadow-sm'
              : 'text-text-subtle hover:text-text hover:bg-surface-hover',
          )}
        >
          <Percent className="h-3.5 w-3.5" />
          Descontos
        </button>
        <button
          type="button"
          data-testid="tab-cancelamentos"
          onClick={() => {
            setTab('cancelamentos');
            setPage(1);
          }}
          className={cn(
            'inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium transition-colors',
            tab === 'cancelamentos'
              ? 'bg-surface text-text shadow-sm'
              : 'text-text-subtle hover:text-text hover:bg-surface-hover',
          )}
        >
          <Ban className="h-3.5 w-3.5" />
          Cancelamentos
        </button>
      </div>

      {tab === 'cancelamentos' ? (
        <CancelamentosTab />
      ) : (
      <Card padding="none" className="overflow-hidden">
        {/* Toolbar com status tabs */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1 p-1 bg-bg-alt rounded-md border border-border">
            {(['', 'PENDENTE', 'APROVADA', 'REJEITADA'] as const).map((s) => {
              const active = status === s;
              const label = s === '' ? 'Todas' : STATUS_LABEL[s as AprovacaoStatus];
              const Icon = s !== '' ? STATUS_ICON[s as AprovacaoStatus] : null;
              return (
                <button
                  key={s || 'all'}
                  type="button"
                  onClick={() => {
                    setStatus(s);
                    setPage(1);
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-7 px-3 rounded text-xs font-medium',
                    'transition-colors duration-100',
                    active
                      ? 'bg-surface text-text shadow-sm'
                      : 'text-text-subtle hover:text-text hover:bg-surface-hover',
                  )}
                  data-testid={`filter-${s || 'all'}`}
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {label}
                  {counts && s !== '' && counts[s as AprovacaoStatus] > 0 && (
                    <Badge size="sm" variant={active ? 'primary' : 'neutral'}>
                      {counts[s as AprovacaoStatus]}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <StateView loading={loading} error={error} onRetry={refetch}>
          {pageResp && pageResp.data.length === 0 && (
            <EmptyState
              icon={status === 'PENDENTE' ? <CheckCircle2 /> : <FileText />}
              title={
                status === 'PENDENTE'
                  ? 'Tudo em dia! Sem aprovações pendentes.'
                  : 'Nenhuma aprovação nesse filtro'
              }
              description={
                status === 'PENDENTE'
                  ? 'Quando um representante solicitar desconto acima do teto, aparecerá aqui.'
                  : 'Tente trocar o filtro.'
              }
              className="m-6 border-0"
            />
          )}
          {pageResp && pageResp.data.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
              {pageResp.data.map((a) => (
                <AprovacaoCard key={a.id} aprovacao={a} onOpen={() => setSelected(a.id)} />
              ))}
            </div>
          )}
        </StateView>
      </Card>

      )}

      {selected && tab === 'descontos' && (
        <AprovacaoDetailDialog
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

// ─── P6.2 — Solicitações de cancelamento ──────────────────────────

type CancelamentoStatus = 'PENDENTE' | 'APROVADA' | 'REJEITADA';

interface CancelamentoSolicitacao {
  id: string;
  motivo: string;
  status: CancelamentoStatus;
  decisaoComentario?: string | null;
  criadoEm: string;
  decididoEm?: string | null;
  solicitante?: { id: string; nome: string };
  decididoPor?: { id: string; nome: string } | null;
  pedido?: {
    id: string;
    numero: string | number;
    total: number;
    status: string;
    cliente?: { id: string; nome: string };
    representante?: { id: string; nome: string } | null;
  };
}

const CANCEL_STATUS_VARIANT: Record<CancelamentoStatus, 'warning' | 'success' | 'danger'> = {
  PENDENTE: 'warning',
  APROVADA: 'success',
  REJEITADA: 'danger',
};

const CANCEL_STATUS_LABEL: Record<CancelamentoStatus, string> = {
  PENDENTE: 'Pendente',
  APROVADA: 'Aprovada',
  REJEITADA: 'Rejeitada',
};

function CancelamentosTab() {
  const role = useRole();
  const canDecide = role === 'DIRECTOR' || role === 'ADMIN';
  const [status, setStatus] = useState<string>('PENDENTE');
  const [page, setPage] = useState(1);
  const [decidir, setDecidir] = useState<{
    solicitacao: CancelamentoSolicitacao;
    decisao: 'APROVADA' | 'REJEITADA';
  } | null>(null);
  const [comentario, setComentario] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (status) qs.set('status', status);
    return `/pedidos/cancelamentos?${qs.toString()}`;
  }, [page, status]);

  const { data: pageResp, loading, error: listError, refetch } =
    useApiQuery<PaginatedResponse<CancelamentoSolicitacao>>(listPath);

  async function confirmarDecisao() {
    if (!decidir) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/pedidos/cancelamentos/${decidir.solicitacao.id}/decidir`, {
        decisao: decidir.decisao,
        comentario: comentario.trim() || undefined,
      });
      setDecidir(null);
      setComentario('');
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao decidir');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Filtro por status */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1 p-1 bg-bg-alt rounded-md border border-border">
          {(['', 'PENDENTE', 'APROVADA', 'REJEITADA'] as const).map((s) => {
            const active = status === s;
            const label = s === '' ? 'Todas' : CANCEL_STATUS_LABEL[s as CancelamentoStatus];
            return (
              <button
                key={s || 'all'}
                type="button"
                onClick={() => {
                  setStatus(s);
                  setPage(1);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 h-7 px-3 rounded text-xs font-medium transition-colors',
                  active
                    ? 'bg-surface text-text shadow-sm'
                    : 'text-text-subtle hover:text-text hover:bg-surface-hover',
                )}
                data-testid={`cancel-filter-${s || 'all'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <StateView loading={loading} error={listError} onRetry={refetch}>
        {pageResp && pageResp.data.length === 0 && (
          <EmptyState
            icon={<Ban />}
            title="Nenhuma solicitação"
            description={
              status === 'PENDENTE'
                ? 'Quando representante/gerente pedir cancelamento de pedido, aparece aqui.'
                : 'Tente trocar o filtro de status.'
            }
            className="m-6 border-0"
          />
        )}
        {pageResp && pageResp.data.length > 0 && (
          <div className="flex flex-col divide-y divide-border">
            {pageResp.data.map((c) => (
              <div
                key={c.id}
                className="p-4 flex flex-col gap-2"
                data-testid={`cancel-card-${c.id}`}
              >
                <header className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-text">
                      Pedido #{c.pedido?.numero ?? '—'}{' '}
                      <span className="text-text-subtle font-normal">
                        · {c.pedido?.cliente?.nome ?? '—'}
                      </span>
                    </h4>
                    <div className="text-xs text-muted mt-0.5">
                      Solicitado por <strong>{c.solicitante?.nome ?? '—'}</strong> em{' '}
                      {new Date(c.criadoEm).toLocaleString('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </div>
                  </div>
                  <Badge variant={CANCEL_STATUS_VARIANT[c.status]}>
                    {CANCEL_STATUS_LABEL[c.status]}
                  </Badge>
                </header>

                <div className="px-3 py-2 rounded-md bg-bg-alt border border-border text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                    Motivo
                  </div>
                  <p className="m-0 whitespace-pre-wrap">{c.motivo}</p>
                </div>

                {c.status !== 'PENDENTE' && c.decididoPor && (
                  <div className="text-xs text-muted">
                    {c.status === 'APROVADA' ? 'Aprovada' : 'Rejeitada'} por{' '}
                    <strong>{c.decididoPor.nome}</strong>
                    {c.decididoEm &&
                      ` em ${new Date(c.decididoEm).toLocaleString('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}`}
                    {c.decisaoComentario && (
                      <p className="mt-1 m-0 italic">"{c.decisaoComentario}"</p>
                    )}
                  </div>
                )}

                {canDecide && c.status === 'PENDENTE' && (
                  <div className="flex gap-2 mt-1">
                    <Button
                      variant="primary"
                      size="sm"
                      data-testid={`cancel-aprovar-${c.id}`}
                      onClick={() => {
                        setDecidir({ solicitacao: c, decisao: 'APROVADA' });
                        setError(null);
                      }}
                      leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    >
                      Aprovar e cancelar pedido
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid={`cancel-rejeitar-${c.id}`}
                      onClick={() => {
                        setDecidir({ solicitacao: c, decisao: 'REJEITADA' });
                        setError(null);
                      }}
                      leftIcon={<XCircle className="h-3.5 w-3.5" />}
                    >
                      Rejeitar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </StateView>

      {decidir && (
        <Dialog
          open
          onClose={() => {
            setDecidir(null);
            setComentario('');
            setError(null);
          }}
          title={decidir.decisao === 'APROVADA' ? 'Aprovar cancelamento?' : 'Rejeitar solicitação?'}
          description={
            decidir.decisao === 'APROVADA'
              ? `Vai cancelar o pedido #${decidir.solicitacao.pedido?.numero}. Não dá pra desfazer.`
              : `A solicitação será registrada como rejeitada. O pedido continua ativo.`
          }
          size="sm"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setDecidir(null);
                  setComentario('');
                  setError(null);
                }}
              >
                Voltar
              </Button>
              <Button
                variant={decidir.decisao === 'APROVADA' ? 'primary' : 'danger'}
                loading={busy}
                onClick={() => void confirmarDecisao()}
                data-testid="cancel-decidir-confirmar"
              >
                Confirmar {decidir.decisao === 'APROVADA' ? 'aprovação' : 'rejeição'}
              </Button>
            </>
          }
        >
          <Field label="Comentário (opcional)" hint="Visível pro solicitante">
            <Textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Ex: cliente já recebeu o produto, não dá mais pra cancelar..."
              rows={3}
              maxLength={500}
              data-testid="cancel-decidir-comentario"
            />
          </Field>
          {error && (
            <div className="mt-2 px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </Dialog>
      )}
    </Card>
  );
}

// ─── Card ──────────────────────────────────────────────────

function AprovacaoCard({
  aprovacao,
  onOpen,
}: {
  aprovacao: Aprovacao;
  onOpen: () => void;
}) {
  const teto = aprovacao.representante?.tetoDesconto;
  const excede = teto !== undefined ? aprovacao.descontoSolicitado - teto : null;
  const isPendente = aprovacao.status === 'PENDENTE';
  const StatusIcon = STATUS_ICON[aprovacao.status];

  return (
    <Card
      padding="md"
      variant={isPendente ? 'outline' : 'default'}
      className={cn(
        'flex flex-col gap-3 cursor-pointer hover:border-primary/40 transition-colors',
        isPendente && 'border-warning/40 bg-warning/5',
      )}
      onClick={onOpen}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold text-text tracking-tight">
            Pedido #{aprovacao.pedido?.numero ?? '—'}
          </h3>
          <div className="text-xs text-muted truncate mt-0.5">
            {aprovacao.pedido?.cliente?.nome ?? '—'}
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[aprovacao.status]} className="inline-flex items-center gap-1">
          <StatusIcon className="h-2.5 w-2.5" />
          {STATUS_LABEL[aprovacao.status]}
        </Badge>
      </header>

      {/* Desconto destacado */}
      <div className="rounded-md bg-bg-alt border border-border px-3 py-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted">Desconto pedido</div>
            <div className="text-2xl font-bold text-warning tabular tracking-tight">
              {fmtPct(aprovacao.descontoSolicitado)}
            </div>
          </div>
          {teto !== undefined && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted">Teto rep</div>
              <div className="text-sm text-text-subtle tabular">{fmtPct(teto)}</div>
            </div>
          )}
        </div>
        {excede !== null && excede > 0 && (
          <div className="mt-1.5 text-[11px] text-danger flex items-center gap-1 tabular">
            <TrendingUp className="h-3 w-3" />+{fmtPct(excede)} acima do teto
          </div>
        )}
      </div>

      {/* Solicitante + valor */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          {aprovacao.representante && (
            <>
              <Avatar name={aprovacao.representante.nome} size="xs" />
              <span className="text-text-subtle truncate">{aprovacao.representante.nome}</span>
            </>
          )}
        </div>
        {aprovacao.pedido?.total !== undefined && (
          <div className="text-right text-text-subtle tabular">
            {fmtBRL(aprovacao.pedido.total)}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between pt-2 border-t border-border">
        <span className="text-[11px] text-muted tabular">{fmtDate(aprovacao.criadoEm)}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          data-testid={`aprov-open-${aprovacao.id}`}
        >
          {isPendente ? 'Decidir' : 'Ver'}
        </Button>
      </footer>
    </Card>
  );
}

// ─── Detail dialog ────────────────────────────────────────

function AprovacaoDetailDialog({
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
    <Dialog
      open
      onClose={onClose}
      title="Aprovação de desconto"
      description={data ? `Pedido #${data.pedido?.numero ?? '—'}` : undefined}
      size="lg"
      footer={
        isPendente ? (
          acao === null ? (
            <>
              <Button
                variant="danger"
                data-testid="aprov-rejeitar"
                onClick={() => setAcao('rejeitar')}
                leftIcon={<XCircle className="h-3.5 w-3.5" />}
              >
                Rejeitar
              </Button>
              <Button
                data-testid="aprov-aprovar"
                onClick={() => setAcao('aprovar')}
                leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
              >
                Aprovar
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setAcao(null)}>
                Voltar
              </Button>
              <Button
                variant={acao === 'aprovar' ? 'primary' : 'danger'}
                data-testid={`aprov-confirmar-${acao}`}
                onClick={decidir}
                loading={busy}
                leftIcon={
                  acao === 'aprovar' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )
                }
              >
                {acao === 'aprovar' ? 'Confirmar aprovação' : 'Confirmar rejeição'}
              </Button>
            </>
          )
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        )
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div className="flex flex-col gap-4">
            {/* Desconto destacado */}
            <Card variant="outline" padding="md" className="bg-warning/5 border-warning/30 text-center">
              <div className="text-[11px] uppercase tracking-wider text-muted mb-1">
                Desconto solicitado
              </div>
              <div className="text-4xl font-bold text-warning tabular tracking-tight">
                {fmtPct(data.descontoSolicitado)}
              </div>
              {teto !== undefined && (
                <div className="text-xs text-muted mt-2 tabular">
                  Teto do representante: {fmtPct(teto)}
                  {excede !== null && excede > 0 && (
                    <span className="text-danger ml-2">
                      (+{fmtPct(excede)} acima)
                    </span>
                  )}
                </div>
              )}
            </Card>

            {/* Info grid */}
            <section>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                Detalhes
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <InfoCell icon={<Receipt />} label="Pedido">
                  <div>
                    <strong className="text-text tabular">#{data.pedido?.numero ?? '—'}</strong>
                    {data.pedido?.cliente?.nome && (
                      <div className="text-xs text-muted truncate">{data.pedido.cliente.nome}</div>
                    )}
                  </div>
                </InfoCell>
                <InfoCell icon={<Receipt />} label="Valor total">
                  <span className="font-semibold tabular">
                    {data.pedido?.total !== undefined ? fmtBRL(data.pedido.total) : '—'}
                  </span>
                </InfoCell>
                <InfoCell icon={<User />} label="Solicitante" avatar={data.representante?.nome}>
                  <div>{data.representante?.nome ?? '—'}</div>
                </InfoCell>
                <InfoCell icon={<User />} label="Gerente alocado">
                  <div>{data.gerente?.nome ?? '—'}</div>
                </InfoCell>
              </div>
            </section>

            {/* Motivo */}
            <Card variant="outline" padding="md" className="bg-bg-alt">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2 flex items-center gap-1">
                <Percent className="h-3 w-3" />
                Justificativa do representante
              </h4>
              <p className="m-0 whitespace-pre-wrap text-sm text-text">{data.motivo}</p>
            </Card>

            {/* Decisão (se já houve) */}
            {data.comentarioAprovador && (
              <Card
                variant="outline"
                padding="md"
                className={cn(
                  data.status === 'APROVADA'
                    ? 'bg-success/10 border-success/30'
                    : 'bg-danger/10 border-danger/30',
                )}
              >
                <h4
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1',
                    data.status === 'APROVADA' ? 'text-success' : 'text-danger',
                  )}
                >
                  {data.status === 'APROVADA' ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <XCircle className="h-3 w-3" />
                  )}
                  Decisão do aprovador
                </h4>
                <p className="m-0 whitespace-pre-wrap text-sm text-text">
                  {data.comentarioAprovador}
                </p>
                {data.resolvidoEm && (
                  <p className="text-[11px] text-muted mt-2 m-0 tabular">
                    Resolvido em {fmtDate(data.resolvidoEm)}
                  </p>
                )}
              </Card>
            )}

            {/* Form de comentário (quando decidindo) */}
            {isPendente && acao !== null && (
              <Card
                variant="outline"
                padding="md"
                className={cn(
                  acao === 'aprovar'
                    ? 'bg-primary/5 border-primary/30'
                    : 'bg-danger/5 border-danger/30',
                )}
              >
                <Field
                  label={`Comentário ${acao === 'rejeitar' ? 'obrigatório' : '(opcional)'}`}
                  required={acao === 'rejeitar'}
                  hint={
                    acao === 'rejeitar'
                      ? 'Explique pro representante por que o desconto não foi aprovado.'
                      : 'Notas pro histórico — ex: "OK por se tratar de cliente VIP"'
                  }
                >
                  <Textarea
                    data-testid="aprov-comentario-input"
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    maxLength={500}
                    rows={4}
                    placeholder={
                      acao === 'aprovar'
                        ? 'Aprovação justificada por...'
                        : 'Desconto fora da política porque...'
                    }
                    autoFocus
                  />
                </Field>
              </Card>
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
    </Dialog>
  );
}

function InfoCell({
  icon,
  label,
  children,
  avatar,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  avatar?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-alt px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted mb-1 [&>svg]:h-3 [&>svg]:w-3">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm text-text flex items-center gap-1.5 min-w-0">
        {avatar && <Avatar name={avatar} size="xs" />}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
