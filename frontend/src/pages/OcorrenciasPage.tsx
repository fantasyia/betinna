import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { alpha, badge, btn, btnSecondary, card, colors } from '@/components/styles';

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
  ABERTA: colors.warning,
  EM_ANDAMENTO: '#0891b2',
  RESOLVIDA: colors.success,
  CANCELADA: colors.muted,
};
const STATUS_LABEL: Record<OcorrenciaStatus, string> = {
  ABERTA: 'Aberta',
  EM_ANDAMENTO: 'Em andamento',
  RESOLVIDA: 'Resolvida',
  CANCELADA: 'Cancelada',
};

const SEV_COLOR: Record<Severidade, string> = {
  baixa: colors.muted,
  media: '#0891b2',
  alta: colors.warning,
  critica: colors.danger,
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
          <div style={{ fontWeight: 600 }}>{o.titulo}</div>
          <div style={{ fontSize: 11, color: colors.muted }}>
            {o.tipo} · {o.cliente?.nome ?? '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'sev',
      header: 'Sev.',
      render: (o) => (
        <span style={{ ...badge(SEV_COLOR[o.severidade]), textTransform: 'uppercase' }}>
          {o.severidade}
        </span>
      ),
    },
    {
      key: 'resp',
      header: 'Responsável',
      render: (o) => o.responsavel?.nome ?? <em style={{ color: colors.muted }}>sem resp.</em>,
    },
    {
      key: 'sla',
      header: 'SLA',
      render: (o) => {
        if (['RESOLVIDA', 'CANCELADA'].includes(o.status)) return '—';
        const h = hoursUntil(o.slaVenceEm);
        if (h === null) return '—';
        const color = h < 0 ? colors.danger : h <= 4 ? colors.warning : colors.muted;
        return (
          <span style={{ color, fontSize: 13, fontWeight: 500 }}>
            {h < 0 ? `${-h}h estourado` : `${h}h restantes`}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (o) => <span style={badge(STATUS_COLOR[o.status])}>{STATUS_LABEL[o.status]}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (o) => (
        <button
          type="button"
          data-testid={`oc-open-${o.id}`}
          onClick={() => setSelected(o.id)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
        >
          Abrir
        </button>
      ),
    },
  ];

  return (
    <PageLayout
      title="Ocorrências / SAC"
      actions={
        <button
          type="button"
          data-testid="oc-new-btn"
          onClick={() => setCreating(true)}
          style={btn}
        >
          + Nova ocorrência
        </button>
      }
    >
      {clienteIdFilter && (
        <div
          data-testid="ocorrencias-cliente-filter-banner"
          style={{
            marginBottom: 12,
            padding: '0.5rem 0.75rem',
            borderRadius: 6,
            background: colors.infoLight,
            border: `1px solid ${colors.info}`,
            color: colors.text,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ flex: 1 }}>
            Filtrando ocorrências de um cliente específico.
          </span>
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('clienteId');
              setSearchParams(next, { replace: true });
            }}
            style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
          >
            Ver todas
          </button>
        </div>
      )}
      {resumo && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <StatBox label="Abertas" value={String(resumo.abertas)} color={colors.warning} />
          <StatBox label="Em andamento" value={String(resumo.emAndamento)} color="#0891b2" />
          <StatBox
            label="Resolvidas (mês)"
            value={String(resumo.resolvidasMes)}
            color={colors.success}
          />
          <StatBox
            label="SLA estourado"
            value={String(resumo.slaEstourado)}
            color={colors.danger}
          />
        </div>
      )}

      <div style={card}>
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
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: '0.75rem',
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          color: colors.muted,
          fontWeight: 600,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
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
    <Modal
      open
      onClose={onClose}
      width={680}
      title={data ? `Ocorrência #${data.numero}` : 'Ocorrência'}
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              onClose();
              onClosedExternal();
            }}
            style={btnSecondary}
          >
            Fechar
          </button>
          {data && data.status === 'ABERTA' && (
            <button
              type="button"
              data-testid="oc-em-andamento"
              disabled={busy}
              onClick={() => changeStatus('EM_ANDAMENTO')}
              style={btn}
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
              style={btn}
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
            <header style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <span style={badge(STATUS_COLOR[data.status])}>{STATUS_LABEL[data.status]}</span>
              <span style={{ ...badge(SEV_COLOR[data.severidade]), textTransform: 'uppercase' }}>
                {data.severidade}
              </span>
              <span style={badge(colors.muted)}>{data.tipo}</span>
            </header>

            <h2 style={{ margin: '0 0 0.5rem', fontSize: 18 }}>{data.titulo}</h2>
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 0, fontSize: 14, color: colors.text }}>
              {data.descricao}
            </p>

            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: 13, marginTop: '0.75rem' }}>
              <Info label="Cliente">{data.cliente?.nome ?? '—'}</Info>
              <Info label="Responsável">{data.responsavel?.nome ?? 'sem responsável'}</Info>
              <Info label="SLA vence em">{fmtDate(data.slaVenceEm)}</Info>
              <Info label="Criada em">{fmtDate(data.criadoEm)}</Info>
              {data.resolvedoEm && <Info label="Resolvida em">{fmtDate(data.resolvedoEm)}</Info>}
            </dl>

            {data.resolucao && (
              <div
                style={{
                  background: alpha(colors.success, 8),
                  border: `1px solid ${colors.success}`,
                  borderRadius: 6,
                  padding: '0.75rem',
                  marginTop: '0.75rem',
                }}
              >
                <strong style={{ fontSize: 13, color: colors.success }}>RESOLUÇÃO</strong>
                <p style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{data.resolucao}</p>
              </div>
            )}

            <section style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: `1px solid ${colors.border}` }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Timeline</h3>
              {(!data.comentarios || data.comentarios.length === 0) && (
                <p style={{ color: colors.muted, fontSize: 13 }}>Sem comentários ainda.</p>
              )}
              {data.comentarios && data.comentarios.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {data.comentarios.map((c) => (
                    <li
                      key={c.id}
                      style={{
                        background: '#fafbfc',
                        border: `1px solid ${colors.border}`,
                        borderRadius: 6,
                        padding: '0.5rem 0.75rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <strong>{c.autor?.nome ?? '—'}</strong>
                        <span style={{ color: colors.muted }}>{fmtDate(c.criadoEm)}</span>
                      </div>
                      <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontSize: 14 }}>{c.texto}</p>
                    </li>
                  ))}
                </ul>
              )}
              {!['RESOLVIDA', 'CANCELADA'].includes(data.status) && (
                <div style={{ marginTop: '0.75rem' }}>
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
                    style={{ ...btn, marginTop: '0.5rem' }}
                  >
                    {busy ? 'Enviando…' : 'Comentar'}
                  </button>
                </div>
              )}
            </section>

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

      <Modal
        open={resolvingOpen}
        onClose={() => setResolvingOpen(false)}
        title="Marcar como resolvida"
        footer={
          <>
            <button type="button" onClick={() => setResolvingOpen(false)} style={btnSecondary}>
              Voltar
            </button>
            <button
              type="button"
              data-testid="oc-resolver-confirm"
              onClick={doResolver}
              disabled={busy || resolucao.trim().length < 3}
              style={{ ...btn, opacity: busy ? 0.7 : 1 }}
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
    <Modal
      open
      onClose={onClose}
      title="Nova ocorrência"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="oc-form"
            data-testid="oc-save-btn"
            disabled={busy}
            style={{ ...btn, opacity: busy ? 0.6 : 1 }}
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
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
          <p data-testid="form-error" style={{ color: colors.danger, fontSize: 13 }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
