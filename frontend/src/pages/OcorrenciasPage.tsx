import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Dialog } from '@/components/ui';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';

// Classes de layout do badge legado (sem cor — cor vem por inline style dinâmico).
const BADGE_CLASS =
  'inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px]';
// Estilo de cor do badge p/ cor dinâmica (equivale ao badge(color) do styles.ts).
function badgeColorStyle(color: string): React.CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    color,
    border: `1px solid color-mix(in srgb, ${color} 19%, transparent)`,
  };
}

type OcorrenciaStatus = 'ABERTA' | 'EM_ANDAMENTO' | 'RESOLVIDA' | 'CANCELADA';
type OcorrenciaTipo = 'ENTREGA' | 'QUALIDADE' | 'PRAZO' | 'PRODUTO' | 'FINANCEIRO' | 'OUTRO';
type Severidade = 'baixa' | 'media' | 'alta' | 'critica';

interface Comentario {
  id: string;
  autor?: { id: string; nome: string };
  texto: string;
  criadoEm: string;
}

interface Ocorrencia {
  id: string;
  numero: string | number;
  titulo: string;
  descricao?: string;
  status: OcorrenciaStatus;
  tipo: OcorrenciaTipo;
  severidade: Severidade;
  cliente?: { id: string; nome: string };
  responsavel?: { id: string; nome: string } | null;
  pedidoId?: string | null;
  slaVenceEm?: string | null;
  resolvedoEm?: string | null;
  resolucao?: string | null;
  comentarios?: Comentario[];
  criadoEm: string;
}

interface Resumo {
  abertas: number;
  emAndamento: number;
  resolvidasMes: number;
  slaEstourado: number;
}

interface ClienteOpt {
  id: string;
  nome: string;
  cnpj?: string | null;
}

const STATUS_COLOR: Record<OcorrenciaStatus, string> = {
  ABERTA: 'var(--warning)',
  EM_ANDAMENTO: '#0891b2',
  RESOLVIDA: 'var(--success)',
  CANCELADA: 'var(--muted)',
};
const STATUS_LABEL: Record<OcorrenciaStatus, string> = {
  ABERTA: 'Aberta',
  EM_ANDAMENTO: 'Em andamento',
  RESOLVIDA: 'Resolvida',
  CANCELADA: 'Cancelada',
};

const SEV_COLOR: Record<Severidade, string> = {
  baixa: 'var(--muted)',
  media: '#0891b2',
  alta: 'var(--warning)',
  critica: 'var(--danger)',
};
const SEV_LIST: Severidade[] = ['baixa', 'media', 'alta', 'critica'];

const TIPOS: OcorrenciaTipo[] = ['ENTREGA', 'QUALIDADE', 'PRAZO', 'PRODUTO', 'FINANCEIRO', 'OUTRO'];

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

export default function OcorrenciasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [severidade, setSeveridade] = useState('');
  const [tipo, setTipo] = useState('');
  const [slaEstourado, setSlaEstourado] = useState('');
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
    if (severidade) qs.set('severidade', severidade);
    if (tipo) qs.set('tipo', tipo);
    if (clienteIdFilter) qs.set('clienteId', clienteIdFilter);
    if (slaEstourado) qs.set('slaEstourado', slaEstourado);
    return `/ocorrencias?${qs.toString()}`;
  }, [page, search, status, severidade, tipo, slaEstourado, clienteIdFilter]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Ocorrencia>>(listPath);
  const { data: resumo } = useApiQuery<Resumo>('/ocorrencias/resumo');

  const columns: Column<Ocorrencia>[] = [
    {
      key: 'numero',
      header: '#',
      render: (o) => <strong>#{o.numero}</strong>,
    },
    {
      key: 'titulo',
      header: 'Título',
      render: (o) => (
        <div>
          <div className="font-semibold">{o.titulo}</div>
          <div className="text-[11px] text-muted">
            {o.tipo} · {o.cliente?.nome ?? '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'sev',
      header: 'Sev.',
      render: (o) => (
        <span className={`${BADGE_CLASS} uppercase`} style={badgeColorStyle(SEV_COLOR[o.severidade])}>
          {o.severidade}
        </span>
      ),
    },
    {
      key: 'resp',
      header: 'Responsável',
      render: (o) => o.responsavel?.nome ?? <em className="text-muted">sem resp.</em>,
    },
    {
      key: 'sla',
      header: 'SLA',
      render: (o) => {
        if (['RESOLVIDA', 'CANCELADA'].includes(o.status)) return '—';
        const h = hoursUntil(o.slaVenceEm);
        if (h === null) return '—';
        const color = h < 0 ? 'var(--danger)' : h <= 4 ? 'var(--warning)' : 'var(--muted)';
        return (
          <span className="text-[13px] font-medium" style={{ color }}>
            {h < 0 ? `${-h}h estourado` : `${h}h restantes`}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (o) => (
        <span className={BADGE_CLASS} style={badgeColorStyle(STATUS_COLOR[o.status])}>
          {STATUS_LABEL[o.status]}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (o) => (
        <button
          type="button"
          data-testid={`oc-open-${o.id}`}
          onClick={() => setSelected(o.id)}
          className="bg-surface text-text border border-border-strong rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer tracking-[-0.1px]"
        >
          Abrir
        </button>
      ),
    },
  ];

  return (
    <PageLayout
      title="Atendimento — SAC interno"
      description="Tickets internos com SLA, severidade e tipos de ocorrência."
      actions={
        <button
          type="button"
          data-testid="oc-new-btn"
          onClick={() => setCreating(true)}
          className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
        >
          + Nova ocorrência
        </button>
      }
    >
      <AtendimentoTabs />
      {clienteIdFilter && (
        <div
          data-testid="ocorrencias-cliente-filter-banner"
          className="mb-3 py-2 px-3 rounded-md bg-[#eaf0fb] border border-info text-text text-[13px] flex items-center gap-2"
        >
          <span className="flex-1">
            Filtrando ocorrências de um cliente específico.
          </span>
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('clienteId');
              setSearchParams(next, { replace: true });
            }}
            className="bg-surface text-text border border-border-strong rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer tracking-[-0.1px]"
          >
            Ver todas
          </button>
        </div>
      )}
      {resumo && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-4">
          <StatBox label="Abertas" value={String(resumo.abertas)} color="var(--warning)" />
          <StatBox label="Em andamento" value={String(resumo.emAndamento)} color="#0891b2" />
          <StatBox
            label="Resolvidas (mês)"
            value={String(resumo.resolvidasMes)}
            color="var(--success)"
          />
          <StatBox
            label="SLA estourado"
            value={String(resumo.slaEstourado)}
            color="var(--danger)"
          />
        </div>
      )}

      <div className="bg-surface border border-border rounded-[10px] p-6">
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Título, descrição, cliente…"
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
            {(Object.keys(STATUS_LABEL) as OcorrenciaStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            data-testid="filter-sev"
            value={severidade}
            onChange={(e) => {
              setSeveridade(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas severidades</option>
            {SEV_LIST.map((s) => (
              <option key={s} value={s}>
                {s.toUpperCase()}
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
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            data-testid="filter-sla"
            value={slaEstourado}
            onChange={(e) => {
              setSlaEstourado(e.target.value);
              setPage(1);
            }}
          >
            <option value="">SLA: todos</option>
            <option value="true">Apenas estourados</option>
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhuma ocorrência encontrada."
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(o) => o.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      {selected && (
        <OcorrenciaDetailModal
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            refetch();
          }}
          onClosedExternal={() => setSelected(null)}
        />
      )}
      {creating && (
        <OcorrenciaFormModal
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

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-surface border border-border rounded-md p-3">
      <div className="text-[11px] uppercase text-muted font-semibold tracking-[0.3px]">
        {label}
      </div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

// ─── Detail ───────────────────────────────────────────────────────────

function OcorrenciaDetailModal({
  id,
  onClose,
  onChanged,
  onClosedExternal,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onClosedExternal: () => void;
}) {
  const { data, loading, error, refetch } = useApiQuery<Ocorrencia>(`/ocorrencias/${id}`);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolvingOpen, setResolvingOpen] = useState(false);
  const [resolucao, setResolucao] = useState('');

  async function addComment() {
    if (!comment.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/ocorrencias/${id}/comentarios`, { texto: comment.trim() });
      setComment('');
      refetch();
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao comentar');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(novo: OcorrenciaStatus) {
    setBusy(true);
    setActionError(null);
    try {
      await api.put(`/ocorrencias/${id}/status`, { status: novo });
      refetch();
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao mudar status');
    } finally {
      setBusy(false);
    }
  }

  async function doResolver() {
    if (resolucao.trim().length < 3) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/ocorrencias/${id}/resolver`, { resolucao: resolucao.trim() });
      setResolvingOpen(false);
      setResolucao('');
      refetch();
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao resolver');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={data ? `Ocorrência #${data.numero}` : 'Ocorrência'}
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              onClose();
              onClosedExternal();
            }}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Fechar
          </button>
          {data && data.status === 'ABERTA' && (
            <button
              type="button"
              data-testid="oc-em-andamento"
              disabled={busy}
              onClick={() => changeStatus('EM_ANDAMENTO')}
              className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
            >
              Pegar atendimento
            </button>
          )}
          {data && !['RESOLVIDA', 'CANCELADA'].includes(data.status) && (
            <button
              type="button"
              data-testid="oc-resolver"
              disabled={busy}
              onClick={() => setResolvingOpen(true)}
              className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
            >
              Resolver
            </button>
          )}
        </>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div>
            <header className="flex gap-2 flex-wrap mb-4">
              <span className={BADGE_CLASS} style={badgeColorStyle(STATUS_COLOR[data.status])}>
                {STATUS_LABEL[data.status]}
              </span>
              <span className={`${BADGE_CLASS} uppercase`} style={badgeColorStyle(SEV_COLOR[data.severidade])}>
                {data.severidade}
              </span>
              <span className={`${BADGE_CLASS} bg-muted/12 text-muted border border-muted/19`}>{data.tipo}</span>
            </header>

            <h2 className="m-0 mb-2 text-[18px]">{data.titulo}</h2>
            <p className="whitespace-pre-wrap mt-0 text-sm text-text">
              {data.descricao}
            </p>

            <dl className="grid grid-cols-2 gap-2 text-[13px] mt-3">
              <Info label="Cliente">{data.cliente?.nome ?? '—'}</Info>
              <Info label="Responsável">{data.responsavel?.nome ?? 'sem responsável'}</Info>
              <Info label="SLA vence em">{fmtDate(data.slaVenceEm)}</Info>
              <Info label="Criada em">{fmtDate(data.criadoEm)}</Info>
              {data.resolvedoEm && <Info label="Resolvida em">{fmtDate(data.resolvedoEm)}</Info>}
            </dl>

            {data.resolucao && (
              <div className="bg-success/8 border border-success rounded-md p-3 mt-3">
                <strong className="text-[13px] text-success">RESOLUÇÃO</strong>
                <p className="mt-1 whitespace-pre-wrap">{data.resolucao}</p>
              </div>
            )}

            <section className="mt-5 pt-4 border-t border-border">
              <h3 className="mt-0 text-sm">Timeline</h3>
              {(!data.comentarios || data.comentarios.length === 0) && (
                <p className="text-muted text-[13px]">Sem comentários ainda.</p>
              )}
              {data.comentarios && data.comentarios.length > 0 && (
                <ul className="list-none p-0 m-0 flex flex-col gap-2">
                  {data.comentarios.map((c) => (
                    <li
                      key={c.id}
                      className="bg-bg-alt border border-border rounded-md py-2 px-3"
                    >
                      <div className="flex justify-between text-xs">
                        <strong>{c.autor?.nome ?? '—'}</strong>
                        <span className="text-muted">{fmtDate(c.criadoEm)}</span>
                      </div>
                      <p className="m-0 mt-1 whitespace-pre-wrap text-sm">{c.texto}</p>
                    </li>
                  ))}
                </ul>
              )}
              {!['RESOLVIDA', 'CANCELADA'].includes(data.status) && (
                <div className="mt-3">
                  <Textarea
                    data-testid="oc-comentario-input"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Adicionar comentário…"
                  />
                  <button
                    type="button"
                    data-testid="oc-comentar-btn"
                    onClick={addComment}
                    disabled={busy || comment.trim().length === 0}
                    className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px] mt-2"
                  >
                    {busy ? 'Enviando…' : 'Comentar'}
                  </button>
                </div>
              )}
            </section>

            {actionError && (
              <div
                data-testid="action-error"
                className="bg-surface border border-danger rounded-[10px] text-danger py-2 px-3 mt-3"
              >
                {actionError}
              </div>
            )}
          </div>
        )}
      </StateView>

      <Dialog
        open={resolvingOpen}
        onClose={() => setResolvingOpen(false)}
        title="Marcar como resolvida"
        footer={
          <>
            <button
              type="button"
              onClick={() => setResolvingOpen(false)}
              className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
            >
              Voltar
            </button>
            <button
              type="button"
              data-testid="oc-resolver-confirm"
              onClick={doResolver}
              disabled={busy || resolucao.trim().length < 3}
              className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
              style={{ opacity: busy ? 0.7 : 1 }}
            >
              {busy ? 'Resolvendo…' : 'Confirmar'}
            </button>
          </>
        }
      >
        <FormField label="O que foi feito pra resolver?" htmlFor="oc-res" required>
          <Textarea
            id="oc-res"
            data-testid="oc-resolucao-input"
            value={resolucao}
            onChange={(e) => setResolucao(e.target.value)}
            placeholder="Ex: ressarci o cliente em R$ X, transportadora trocada, etc."
            minLength={3}
            required
          />
        </FormField>
      </Dialog>
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

// ─── Create ──────────────────────────────────────────────────────────

function OcorrenciaFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  const [tipo, setTipo] = useState<OcorrenciaTipo>('ENTREGA');
  const [severidade, setSeveridade] = useState<Severidade>('media');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cliente) {
      setError('Selecione um cliente.');
      return;
    }
    if (titulo.trim().length < 3) {
      setError('Título precisa ter no mínimo 3 caracteres.');
      return;
    }
    if (descricao.trim().length < 3) {
      setError('Descrição precisa ter no mínimo 3 caracteres.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/ocorrencias', {
        clienteId: cliente.id,
        tipo,
        severidade,
        titulo: titulo.trim(),
        descricao: descricao.trim(),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar ocorrência');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nova ocorrência"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="oc-form"
            data-testid="oc-save-btn"
            disabled={busy}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
            style={{ opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Criando…' : 'Criar'}
          </button>
        </>
      }
    >
      <form id="oc-form" onSubmit={submit}>
        <FormField label="Cliente" required>
          <AsyncCombobox<ClienteOpt>
            testId="cliente-picker"
            endpoint="/clientes"
            placeholder="Buscar cliente…"
            getLabel={(c) => c.nome}
            getSubLabel={(c) => c.cnpj ?? null}
            getId={(c) => c.id}
            value={cliente}
            onChange={setCliente}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Tipo" htmlFor="oc-tipo">
            <Select id="oc-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as OcorrenciaTipo)}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Severidade" htmlFor="oc-sev">
            <Select
              id="oc-sev"
              value={severidade}
              onChange={(e) => setSeveridade(e.target.value as Severidade)}
            >
              {SEV_LIST.map((s) => (
                <option key={s} value={s}>
                  {s.toUpperCase()}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <FormField label="Título" htmlFor="oc-tit" required hint="3–200 caracteres">
          <Input
            id="oc-tit"
            data-testid="oc-titulo-input"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            minLength={3}
            maxLength={200}
            required
          />
        </FormField>
        <FormField label="Descrição" htmlFor="oc-desc" required>
          <Textarea
            id="oc-desc"
            data-testid="oc-descricao-input"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            minLength={3}
            maxLength={5000}
            required
            style={{ minHeight: 120 }}
          />
        </FormField>
        {error && (
          <p data-testid="form-error" className="text-danger text-[13px]">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
