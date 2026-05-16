import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

type FluxoStatus = 'RASCUNHO' | 'ATIVO' | 'PAUSADO' | 'ARQUIVADO';

type TriggerTipo =
  | 'LEAD_CRIADO'
  | 'LEAD_ETAPA_MUDOU'
  | 'PEDIDO_APROVADO'
  | 'PEDIDO_ENTREGUE'
  | 'OCORRENCIA_ABERTA'
  | 'CLIENTE_INATIVO_30D'
  | 'AMOSTRA_FOLLOWUP'
  | 'CRON_AGENDADO';

interface FluxoListItem {
  id: string;
  nome: string;
  descricao?: string | null;
  status: FluxoStatus;
  triggerTipo?: TriggerTipo | null;
  criadoEm: string;
  atualizadoEm: string;
}

interface FluxoNo {
  id: string;
  tipo: 'TRIGGER' | 'CONDICAO' | 'ACAO' | 'DELAY';
  acaoTipo?: string;
  titulo: string;
  config?: Record<string, unknown>;
  posX?: number;
  posY?: number;
}

interface FluxoEdge {
  id: string;
  sourceNoId: string;
  targetNoId: string;
  label?: string | null;
}

interface FluxoDetail extends FluxoListItem {
  nos?: FluxoNo[];
  arestas?: FluxoEdge[];
  triggerConfig?: Record<string, unknown>;
}

type ExecucaoStatus = 'PENDENTE' | 'EM_EXECUCAO' | 'CONCLUIDO' | 'FALHOU' | 'CANCELADO';

interface Execucao {
  id: string;
  status: ExecucaoStatus;
  iniciadoEm?: string;
  finalizadoEm?: string | null;
  erro?: string | null;
  contexto?: Record<string, unknown>;
}

interface Metricas {
  total: number;
  concluidas: number;
  falhas: number;
  taxaSucesso: number;
  ultimaExecucao?: string | null;
}

const STATUS_COLOR: Record<FluxoStatus, string> = {
  RASCUNHO: colors.muted,
  ATIVO: colors.success,
  PAUSADO: colors.warning,
  ARQUIVADO: colors.muted,
};
const STATUS_LABEL: Record<FluxoStatus, string> = {
  RASCUNHO: 'Rascunho',
  ATIVO: 'Ativo',
  PAUSADO: 'Pausado',
  ARQUIVADO: 'Arquivado',
};

const TRIGGERS: Record<TriggerTipo, string> = {
  LEAD_CRIADO: 'Lead criado',
  LEAD_ETAPA_MUDOU: 'Lead mudou de etapa',
  PEDIDO_APROVADO: 'Pedido aprovado',
  PEDIDO_ENTREGUE: 'Pedido entregue',
  OCORRENCIA_ABERTA: 'Ocorrência aberta',
  CLIENTE_INATIVO_30D: 'Cliente inativo 30 dias',
  AMOSTRA_FOLLOWUP: 'Amostra follow-up',
  CRON_AGENDADO: 'Cron agendado',
};

const EXEC_STATUS_COLOR: Record<ExecucaoStatus, string> = {
  PENDENTE: colors.muted,
  EM_EXECUCAO: '#0891b2',
  CONCLUIDO: colors.success,
  FALHOU: colors.danger,
  CANCELADO: colors.muted,
};

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

export default function FluxosPage() {
  const role = useRole();
  const canEdit = ['ADMIN', 'DIRECTOR'].includes(role ?? '');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [triggerTipo, setTriggerTipo] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) qs.set('search', search.trim());
    if (status) qs.set('status', status);
    if (triggerTipo) qs.set('triggerTipo', triggerTipo);
    return `/fluxos?${qs.toString()}`;
  }, [page, search, status, triggerTipo]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<FluxoListItem>>(listPath);

  async function callAction(id: string, action: 'ativar' | 'pausar' | 'arquivar') {
    try {
      if (action === 'arquivar') {
        await api.delete(`/fluxos/${id}`);
      } else {
        await api.post(`/fluxos/${id}/${action}`);
      }
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Falha');
    }
  }

  const columns: Column<FluxoListItem>[] = [
    {
      key: 'nome',
      header: 'Fluxo',
      render: (f) => (
        <div>
          <div style={{ fontWeight: 600 }}>{f.nome}</div>
          {f.descricao && (
            <div style={{ fontSize: 11, color: colors.muted, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.descricao}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'trigger',
      header: 'Trigger',
      render: (f) =>
        f.triggerTipo ? (
          <span style={badge('#0891b2')}>{TRIGGERS[f.triggerTipo]}</span>
        ) : (
          <em style={{ color: colors.muted }}>sem trigger</em>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (f) => <span style={badge(STATUS_COLOR[f.status])}>{STATUS_LABEL[f.status]}</span>,
    },
    {
      key: 'atualizado',
      header: 'Atualizado',
      render: (f) => fmtDate(f.atualizadoEm),
    },
    {
      key: 'actions',
      header: '',
      render: (f) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            data-testid={`fluxo-open-${f.id}`}
            onClick={() => setSelected(f.id)}
            style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
          >
            Abrir
          </button>
          {canEdit && f.status === 'RASCUNHO' && (
            <button
              type="button"
              data-testid={`fluxo-ativar-${f.id}`}
              onClick={() => callAction(f.id, 'ativar')}
              style={{ ...btn, padding: '0.25rem 0.625rem', fontSize: 12 }}
            >
              Ativar
            </button>
          )}
          {canEdit && f.status === 'ATIVO' && (
            <button
              type="button"
              data-testid={`fluxo-pausar-${f.id}`}
              onClick={() => callAction(f.id, 'pausar')}
              style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
            >
              Pausar
            </button>
          )}
          {canEdit && f.status === 'PAUSADO' && (
            <button
              type="button"
              data-testid={`fluxo-retomar-${f.id}`}
              onClick={() => callAction(f.id, 'ativar')}
              style={{ ...btn, padding: '0.25rem 0.625rem', fontSize: 12 }}
            >
              Retomar
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageLayout
      title="Fluxos de automação"
      actions={
        canEdit ? (
          <button
            type="button"
            data-testid="fluxo-new"
            onClick={() => setCreating(true)}
            style={btn}
          >
            + Novo fluxo
          </button>
        ) : undefined
      }
    >
      <div style={card}>
        <FilterBar>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Nome…" />
          <Select
            data-testid="filter-status"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          >
            <option value="">Todos status</option>
            {(Object.keys(STATUS_LABEL) as FluxoStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
          <Select
            data-testid="filter-trigger"
            value={triggerTipo}
            onChange={(e) => { setTriggerTipo(e.target.value); setPage(1); }}
          >
            <option value="">Todos triggers</option>
            {(Object.keys(TRIGGERS) as TriggerTipo[]).map((t) => (
              <option key={t} value={t}>{TRIGGERS[t]}</option>
            ))}
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhum fluxo cadastrado. Crie o primeiro."
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(f) => f.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      <p style={{ fontSize: 12, color: colors.muted, marginTop: '1rem' }}>
        💡 O editor visual (drag-and-drop de nós) está planejado pra uma próxima versão.
        Por enquanto, fluxos podem ser criados via API ou diretamente em código.
        Aqui você gerencia o ciclo de vida (ativar/pausar/arquivar), visualiza execuções e testa.
      </p>

      {selected && (
        <FluxoDetailModal
          id={selected}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onChanged={refetch}
        />
      )}
      {creating && (
        <CreateFluxoModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            refetch();
            setSelected(id);
          }}
        />
      )}
    </PageLayout>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────

function FluxoDetailModal({
  id,
  canEdit,
  onClose,
}: {
  id: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, loading, error, refetch } = useApiQuery<FluxoDetail>(`/fluxos/${id}`);
  const metricas = useApiQuery<Metricas>(`/fluxos/${id}/metricas`);
  const execucoes = useApiQuery<PaginatedResponse<Execucao>>(`/fluxos/${id}/execucoes?limit=10`);

  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  async function testar() {
    setTesting(true);
    setTestError(null);
    try {
      await api.post('/fluxos/testar', { fluxoId: id, contexto: {} });
      setTimeout(() => {
        execucoes.refetch();
        metricas.refetch();
      }, 1500);
    } catch (err) {
      setTestError(err instanceof ApiError ? err.message : 'Falha no teste');
    } finally {
      setTesting(false);
    }
  }

  async function cancelar(execucaoId: string) {
    if (!confirm('Cancelar esta execução?')) return;
    try {
      await api.post(`/fluxos/execucoes/${execucaoId}/cancelar`);
      execucoes.refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Falha');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={780}
      title={data ? data.nome : 'Fluxo'}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Fechar
          </button>
          {canEdit && data && data.status !== 'ARQUIVADO' && (
            <button
              type="button"
              data-testid="fluxo-testar"
              disabled={testing}
              onClick={testar}
              style={btn}
            >
              {testing ? 'Disparando…' : 'Testar execução'}
            </button>
          )}
        </>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div>
            <header style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <span style={badge(STATUS_COLOR[data.status])}>{STATUS_LABEL[data.status]}</span>
              {data.triggerTipo && (
                <span style={badge('#0891b2')}>{TRIGGERS[data.triggerTipo]}</span>
              )}
              <span style={{ fontSize: 12, color: colors.muted }}>
                Atualizado {fmtDate(data.atualizadoEm)}
              </span>
            </header>

            {data.descricao && (
              <p style={{ marginTop: 0, fontSize: 14 }}>{data.descricao}</p>
            )}

            {metricas.data && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '0.5rem',
                  marginBottom: '1rem',
                }}
              >
                <Stat label="Total exec." value={String(metricas.data.total)} />
                <Stat label="Concluídas" value={String(metricas.data.concluidas)} color={colors.success} />
                <Stat label="Falhas" value={String(metricas.data.falhas)} color={metricas.data.falhas > 0 ? colors.danger : colors.muted} />
                <Stat
                  label="Taxa sucesso"
                  value={`${(metricas.data.taxaSucesso * 100).toFixed(1)}%`}
                  color={metricas.data.taxaSucesso > 0.9 ? colors.success : metricas.data.taxaSucesso > 0.7 ? colors.warning : colors.danger}
                />
              </div>
            )}

            {data.nos && data.nos.length > 0 && (
              <section style={{ marginTop: '1rem' }}>
                <h3 style={{ fontSize: 14, margin: '0 0 0.5rem' }}>Nós do fluxo</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {data.nos.map((n) => (
                    <li
                      key={n.id}
                      style={{
                        background: '#fafbfc',
                        border: `1px solid ${colors.border}`,
                        borderRadius: 6,
                        padding: '0.5rem 0.75rem',
                        fontSize: 13,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <span style={{ ...badge(colors.muted), fontSize: 9 }}>{n.tipo}</span>
                      <strong>{n.titulo}</strong>
                      {n.acaoTipo && (
                        <span style={{ fontSize: 11, color: colors.muted }}>· {n.acaoTipo}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section style={{ marginTop: '1.25rem' }}>
              <h3 style={{ fontSize: 14, margin: '0 0 0.5rem' }}>Últimas execuções</h3>
              {execucoes.loading && <p style={{ color: colors.muted }}>Carregando…</p>}
              {execucoes.error && <p style={{ color: colors.danger }}>{execucoes.error}</p>}
              {execucoes.data && execucoes.data.data.length === 0 && (
                <p style={{ color: colors.muted, fontSize: 13 }}>Sem execuções ainda.</p>
              )}
              {execucoes.data && execucoes.data.data.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {execucoes.data.data.map((e) => (
                    <li
                      key={e.id}
                      style={{
                        background: '#fafbfc',
                        border: `1px solid ${colors.border}`,
                        borderRadius: 6,
                        padding: '0.375rem 0.625rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: 12,
                      }}
                    >
                      <span style={badge(EXEC_STATUS_COLOR[e.status])}>{e.status}</span>
                      <span style={{ color: colors.muted }}>{fmtDate(e.iniciadoEm)}</span>
                      {e.erro && (
                        <span style={{ color: colors.danger, fontSize: 11, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.erro}
                        </span>
                      )}
                      {canEdit && (e.status === 'PENDENTE' || e.status === 'EM_EXECUCAO') && (
                        <button
                          type="button"
                          onClick={() => cancelar(e.id)}
                          style={{ ...btnDanger, padding: '0.125rem 0.5rem', fontSize: 10, marginLeft: 'auto' }}
                        >
                          Cancelar
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {testError && (
              <p style={{ color: colors.danger, fontSize: 13, marginTop: '0.5rem' }}>{testError}</p>
            )}
          </div>
        )}
      </StateView>
    </Modal>
  );
}

function Stat({
  label,
  value,
  color = colors.text,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: '#fafbfc',
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: '0.5rem 0.75rem',
      }}
    >
      <div style={{ fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ─── Create modal — apenas metadados básicos ─────────────────────────

function CreateFluxoModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [triggerTipo, setTriggerTipo] = useState<TriggerTipo | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = { nome: nome.trim(), nos: [], arestas: [] };
    if (descricao.trim()) payload.descricao = descricao.trim();
    if (triggerTipo) payload.triggerTipo = triggerTipo;
    try {
      const r = await api.post<{ id: string }>('/fluxos', payload);
      onSaved(r.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo fluxo de automação"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="fluxo-form"
            data-testid="fluxo-save"
            disabled={busy || nome.trim().length === 0}
            style={btn}
          >
            {busy ? 'Criando…' : 'Criar (rascunho)'}
          </button>
        </>
      }
    >
      <form id="fluxo-form" onSubmit={submit}>
        <FormField label="Nome" required>
          <Input
            data-testid="fluxo-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            minLength={1}
            maxLength={150}
            autoFocus
          />
        </FormField>
        <FormField label="Descrição">
          <Textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            maxLength={500}
          />
        </FormField>
        <FormField label="Trigger" hint="Quando o fluxo dispara">
          <Select
            data-testid="fluxo-trigger"
            value={triggerTipo}
            onChange={(e) => setTriggerTipo(e.target.value as TriggerTipo | '')}
          >
            <option value="">Sem trigger (manual)</option>
            {(Object.keys(TRIGGERS) as TriggerTipo[]).map((t) => (
              <option key={t} value={t}>{TRIGGERS[t]}</option>
            ))}
          </Select>
        </FormField>
        <p style={{ fontSize: 12, color: colors.muted }}>
          O fluxo será criado como rascunho. Adicionar nós/ações requer editor visual (em breve)
          ou chamada via API.
        </p>
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </form>
    </Modal>
  );
}
