import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { usePermission, useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/hooks/useConfirm';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

// ─── Types ────────────────────────────────────────────────────────────────────

type CampanhaStatus =
  | 'RASCUNHO'
  | 'AGENDADA'
  | 'ENVIANDO'
  | 'ENVIADA'
  | 'PAUSADA'
  | 'CANCELADA';

type CampanhaCanal = 'WHATSAPP' | 'EMAIL' | 'WHATSAPP_EMAIL';
type TomIA = 'formal' | 'amigavel' | 'urgente' | 'consultivo';

interface Campanha {
  id: string;
  nome: string;
  canal: CampanhaCanal;
  status: CampanhaStatus;
  objetivo?: string | null;
  usarIaPersonalizacao: boolean;
  agendadoPara?: string | null;
  enviadaEm?: string | null;
  totalDestinatarios?: number;
  criadoEm: string;
  atualizadoEm: string;
}

interface CampanhaDetail extends Campanha {
  mensagemWa?: string | null;
  mensagemEmail?: string | null;
  assunto?: string | null;
  segTagIds?: string[];
  segRepIds?: string[];
  segClienteIds?: string[];
}

interface Metricas {
  totalDestinatarios: number;
  enviados: number;
  falhas: number;
  lidos: number;
  taxaEnvio: number;
  taxaLeitura: number;
  taxaErro: number;
}

interface Resumo {
  total: number;
  rascunhos: number;
  agendadas: number;
  enviando: number;
  enviadas: number;
  alcanceUltimos30d: number;
}

interface GerarConteudoResponse {
  mensagemWa?: string;
  mensagemEmail?: string;
  assunto?: string;
  variacoes?: Array<{ mensagemWa?: string; mensagemEmail?: string; assunto?: string }>;
  tokensIn?: number;
  tokensOut?: number;
}

interface OtimizarResponse {
  mensagemOtimizada: string;
  variacoes?: string[];
  dicas?: string[];
}

interface SugerirSegmentoResponse {
  segmentoSugerido: string;
  tagsRecomendadas?: string[];
  tomIdeal?: string;
  melhorHorario?: string;
  justificativa?: string;
}

interface AnalisarResponse {
  insights: string[];
  pontosFortres?: string[];
  melhorias?: string[];
  recomendacoes?: string[];
  score?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<CampanhaStatus, string> = {
  RASCUNHO: colors.muted,
  AGENDADA: '#0891b2',
  ENVIANDO: colors.warning,
  ENVIADA: colors.success,
  PAUSADA: '#7c3aed',
  CANCELADA: colors.danger,
};
const STATUS_LABEL: Record<CampanhaStatus, string> = {
  RASCUNHO: 'Rascunho',
  AGENDADA: 'Agendada',
  ENVIANDO: 'Enviando…',
  ENVIADA: 'Enviada',
  PAUSADA: 'Pausada',
  CANCELADA: 'Cancelada',
};

const CANAL_LABEL: Record<CampanhaCanal, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  WHATSAPP_EMAIL: 'WhatsApp + E-mail',
};
const CANAL_COLOR: Record<CampanhaCanal, string> = {
  WHATSAPP: '#22c55e',
  EMAIL: '#0891b2',
  WHATSAPP_EMAIL: '#7c3aed',
};

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}
function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CampanhasPage() {
  const canCreatePerm = usePermission('campanhas.create');
  const canEditPerm = usePermission('campanhas.edit');
  const canCreate = canCreatePerm || canEditPerm;
  const role = useRole();
  const canManage = ['ADMIN', 'DIRECTOR', 'GERENTE'].includes(role ?? '');
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [canalFilter, setCanalFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) qs.set('search', search.trim());
    if (statusFilter) qs.set('status', statusFilter);
    if (canalFilter) qs.set('canal', canalFilter);
    return `/campanhas?${qs.toString()}`;
  }, [page, search, statusFilter, canalFilter]);

  const { data: pageResp, loading, error, refetch } =
    useApiQuery<PaginatedResponse<Campanha>>(listPath);
  const { data: resumo } = useApiQuery<Resumo>('/campanhas/resumo');

  async function callAction(id: string, action: 'disparar' | 'pausar' | 'cancelar') {
    try {
      await api.post(`/campanhas/${id}/${action}`);
      const labelMap = { disparar: 'disparada', pausar: 'pausada', cancelar: 'cancelada' };
      toast.success(`Campanha ${labelMap[action]}`);
      refetch();
      if (selected === id) setSelected(null);
    } catch (err) {
      toast.error('Falha na operação', err instanceof ApiError ? err.message : undefined);
    }
  }

  const columns: Column<Campanha>[] = [
    {
      key: 'nome',
      header: 'Campanha',
      render: (c) => (
        <div>
          <div style={{ fontWeight: 600 }}>{c.nome}</div>
          {c.objetivo && (
            <div style={{ fontSize: 11, color: colors.muted, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.objetivo}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'canal',
      header: 'Canal',
      render: (c) => (
        <span style={badge(CANAL_COLOR[c.canal])}>{CANAL_LABEL[c.canal]}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => (
        <span style={badge(STATUS_COLOR[c.status])}>{STATUS_LABEL[c.status]}</span>
      ),
    },
    {
      key: 'alcance',
      header: 'Destinatários',
      render: (c) =>
        c.totalDestinatarios !== undefined && c.totalDestinatarios !== null
          ? String(c.totalDestinatarios)
          : <em style={{ color: colors.muted }}>—</em>,
    },
    {
      key: 'agendado',
      header: 'Agendado / Enviado',
      render: (c) =>
        c.enviadaEm ? fmtDate(c.enviadaEm) : c.agendadoPara ? fmtDate(c.agendadoPara) : '—',
    },
    {
      key: 'ia',
      header: 'IA',
      render: (c) =>
        c.usarIaPersonalizacao ? (
          <span style={{ ...badge('#7c3aed'), fontSize: 9 }}>✨ Personalizada</span>
        ) : null,
    },
    {
      key: 'actions',
      header: '',
      render: (c) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            data-testid={`campanha-open-${c.id}`}
            onClick={() => setSelected(c.id)}
            style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
          >
            Abrir
          </button>
          {canManage && c.status === 'RASCUNHO' && (
            <button
              type="button"
              data-testid={`campanha-disparar-${c.id}`}
              onClick={() => callAction(c.id, 'disparar')}
              style={{ ...btn, padding: '0.25rem 0.625rem', fontSize: 12 }}
            >
              ▶ Disparar
            </button>
          )}
          {canManage && c.status === 'ENVIANDO' && (
            <button
              type="button"
              data-testid={`campanha-pausar-${c.id}`}
              onClick={() => callAction(c.id, 'pausar')}
              style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
            >
              ⏸ Pausar
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageLayout
      title="Campanhas"
      actions={
        canCreate ? (
          <button
            type="button"
            data-testid="campanha-new"
            onClick={() => setCreating(true)}
            style={btn}
          >
            + Nova campanha
          </button>
        ) : undefined
      }
    >
      {/* Resumo */}
      {resumo && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <StatBox label="Total" value={String(resumo.total)} />
          <StatBox label="Rascunhos" value={String(resumo.rascunhos)} />
          <StatBox label="Agendadas" value={String(resumo.agendadas)} color="#0891b2" />
          <StatBox label="Enviando" value={String(resumo.enviando)} color={colors.warning} />
          <StatBox label="Enviadas" value={String(resumo.enviadas)} color={colors.success} />
          <StatBox label="Alcance 30d" value={String(resumo.alcanceUltimos30d)} color="#7c3aed" />
        </div>
      )}

      <div style={card}>
        <FilterBar>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Nome da campanha…" />
          <Select
            data-testid="filter-status"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">Todos status</option>
            {(Object.keys(STATUS_LABEL) as CampanhaStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
          <Select
            data-testid="filter-canal"
            value={canalFilter}
            onChange={(e) => { setCanalFilter(e.target.value); setPage(1); }}
          >
            <option value="">Todos canais</option>
            {(Object.keys(CANAL_LABEL) as CampanhaCanal[]).map((c) => (
              <option key={c} value={c}>{CANAL_LABEL[c]}</option>
            ))}
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhuma campanha ainda. Crie a primeira!"
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(c) => c.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      {selected && (
        <CampanhaDetailModal
          id={selected}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onChanged={refetch}
        />
      )}
      {creating && (
        <CreateCampanhaModal
          onClose={() => setCreating(false)}
          onSaved={(id) => { setCreating(false); refetch(); setSelected(id); }}
        />
      )}
    </PageLayout>
  );
}

// ─── Stat box ─────────────────────────────────────────────────────────────────

function StatBox({ label, value, color = colors.text }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ ...card, padding: '0.75rem' }}>
      <div style={{ fontSize: 10, color: colors.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

type DetailTab = 'info' | 'metricas' | 'ia';

function CampanhaDetailModal({
  id,
  canManage,
  onClose,
  onChanged,
}: {
  id: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<CampanhaDetail>(`/campanhas/${id}`);
  const { data: metricas } = useApiQuery<Metricas>(`/campanhas/${id}/metricas`);
  const [tab, setTab] = useState<DetailTab>('info');
  const [acting, setActing] = useState(false);
  const [confirmAsync, ConfirmDialog] = useConfirm();

  async function callAction(action: 'disparar' | 'pausar' | 'cancelar') {
    setActing(true);
    try {
      await api.post(`/campanhas/${id}/${action}`);
      const labelMap = { disparar: 'disparada', pausar: 'pausada', cancelar: 'cancelada' };
      toast.success(`Campanha ${labelMap[action]}`);
      refetch();
      onChanged();
    } catch (err) {
      toast.error('Falha', err instanceof ApiError ? err.message : undefined);
    } finally {
      setActing(false);
    }
  }

  const c = data;

  return (
    <Modal
      open
      onClose={onClose}
      width={740}
      title={c?.nome ?? 'Campanha'}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {canManage && c?.status === 'RASCUNHO' && (
              <button
                type="button"
                data-testid="campanha-disparar"
                disabled={acting}
                onClick={() => callAction('disparar')}
                style={btn}
              >
                ▶ Disparar agora
              </button>
            )}
            {canManage && c?.status === 'ENVIANDO' && (
              <button
                type="button"
                data-testid="campanha-pausar"
                disabled={acting}
                onClick={() => callAction('pausar')}
                style={btnSecondary}
              >
                ⏸ Pausar
              </button>
            )}
            {canManage && (c?.status === 'RASCUNHO' || c?.status === 'AGENDADA' || c?.status === 'PAUSADA') && (
              <button
                type="button"
                data-testid="campanha-cancelar"
                disabled={acting}
                onClick={async () => {
                  const ok = await confirmAsync({
                    title: 'Cancelar esta campanha?',
                    message:
                      'A campanha não dispara mais. Mensagens já enviadas continuam.',
                    confirmLabel: 'Cancelar campanha',
                    variant: 'danger',
                  });
                  if (ok) void callAction('cancelar');
                }}
                style={btnDanger}
              >
                Cancelar
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} style={btnSecondary}>Fechar</button>
        </div>
      }
    >
      {/* Tabs */}
      <div
        role="tablist"
        style={{ display: 'flex', gap: 4, marginBottom: '1rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}
      >
        {(['info', 'metricas', 'ia'] as DetailTab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? `2px solid ${colors.primary}` : '2px solid transparent',
              color: tab === t ? colors.primary : colors.muted,
              fontWeight: tab === t ? 600 : 400,
              fontSize: 13,
              padding: '4px 12px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginBottom: -9,
            }}
          >
            {t === 'info' ? 'Detalhes' : t === 'metricas' ? 'Métricas' : '✨ IA'}
          </button>
        ))}
      </div>

      <StateView loading={loading} error={error} onRetry={refetch}>
        {c && (
          <>
            {tab === 'info' && (
              <div>
                <header style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  <span style={badge(STATUS_COLOR[c.status])}>{STATUS_LABEL[c.status]}</span>
                  <span style={badge(CANAL_COLOR[c.canal])}>{CANAL_LABEL[c.canal]}</span>
                  {c.usarIaPersonalizacao && (
                    <span style={badge('#7c3aed')}>✨ IA personalização</span>
                  )}
                </header>

                {c.objetivo && (
                  <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#fafbfc', borderRadius: 6, border: `1px solid ${colors.border}` }}>
                    <div style={{ fontSize: 11, color: colors.muted, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Objetivo</div>
                    <p style={{ margin: 0, fontSize: 13 }}>{c.objetivo}</p>
                  </div>
                )}

                <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: 13, marginBottom: '1rem' }}>
                  <Info label="Criado em">{fmtDate(c.criadoEm)}</Info>
                  <Info label="Agendado para">{fmtDate(c.agendadoPara)}</Info>
                  <Info label="Enviado em">{fmtDate(c.enviadaEm)}</Info>
                  <Info label="Destinatários">{c.totalDestinatarios !== undefined ? String(c.totalDestinatarios) : '—'}</Info>
                </dl>

                {(c.mensagemWa || c.mensagemEmail) && (
                  <div>
                    {c.mensagemWa && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: 11, color: colors.muted, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>
                          Mensagem WhatsApp
                        </div>
                        <pre style={{ margin: 0, padding: '0.75rem', background: '#fafbfc', border: `1px solid ${colors.border}`, borderRadius: 6, fontSize: 13, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                          {c.mensagemWa}
                        </pre>
                      </div>
                    )}
                    {c.assunto && (
                      <div style={{ marginBottom: '0.5rem' }}>
                        <div style={{ fontSize: 11, color: colors.muted, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>
                          Assunto e-mail
                        </div>
                        <p style={{ margin: 0, padding: '0.5rem 0.75rem', background: '#fafbfc', border: `1px solid ${colors.border}`, borderRadius: 6, fontSize: 13 }}>
                          {c.assunto}
                        </p>
                      </div>
                    )}
                    {c.mensagemEmail && (
                      <div>
                        <div style={{ fontSize: 11, color: colors.muted, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>
                          Corpo e-mail
                        </div>
                        <pre style={{ margin: 0, padding: '0.75rem', background: '#fafbfc', border: `1px solid ${colors.border}`, borderRadius: 6, fontSize: 13, whiteSpace: 'pre-wrap', fontFamily: 'inherit', maxHeight: 200, overflowY: 'auto' }}>
                          {c.mensagemEmail}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === 'metricas' && (
              <div>
                {metricas ? (
                  <>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                        gap: '0.75rem',
                        marginBottom: '1rem',
                      }}
                    >
                      <Stat label="Destinatários" value={String(metricas.totalDestinatarios)} />
                      <Stat label="Enviados" value={String(metricas.enviados)} color={colors.success} />
                      <Stat label="Falhas" value={String(metricas.falhas)} color={metricas.falhas > 0 ? colors.danger : colors.muted} />
                      <Stat label="Lidos" value={String(metricas.lidos)} color="#0891b2" />
                      <Stat label="Taxa envio" value={fmtPct(metricas.taxaEnvio)} color={colors.success} />
                      <Stat label="Taxa leitura" value={fmtPct(metricas.taxaLeitura)} color="#0891b2" />
                      <Stat label="Taxa erro" value={fmtPct(metricas.taxaErro)} color={metricas.taxaErro > 0.05 ? colors.danger : colors.muted} />
                    </div>
                    {metricas.totalDestinatarios === 0 && (
                      <p style={{ color: colors.muted, fontSize: 13, marginTop: 0 }}>
                        Campanha ainda não disparada ou sem destinatários.
                      </p>
                    )}
                  </>
                ) : (
                  <p style={{ color: colors.muted }}>Carregando métricas…</p>
                )}
              </div>
            )}

            {tab === 'ia' && (
              <IAPanel campanha={c} />
            )}
          </>
        )}
      </StateView>
      {ConfirmDialog}
    </Modal>
  );
}

// ─── IA panel ─────────────────────────────────────────────────────────────────

function IAPanel({ campanha }: { campanha: CampanhaDetail }) {
  const [iaMode, setIaMode] = useState<'none' | 'gerar' | 'otimizar' | 'sugerir' | 'analisar'>('none');

  // Gerar conteúdo
  const [objetivo, setObjetivo] = useState(campanha.objetivo ?? '');
  const [tom, setTom] = useState<TomIA>('amigavel');
  const [gerarResult, setGerarResult] = useState<GerarConteudoResponse | null>(null);

  // Otimizar
  const [otimizarTexto, setOtimizarTexto] = useState(campanha.mensagemWa ?? campanha.mensagemEmail ?? '');
  const [otimizarResult, setOtimizarResult] = useState<OtimizarResponse | null>(null);

  // Sugerir segmento
  const [sugerirObj, setSugerirObj] = useState(campanha.objetivo ?? '');
  const [sugerirResult, setSugerirResult] = useState<SugerirSegmentoResponse | null>(null);

  // Analisar
  const [analisarResult, setAnalisarResult] = useState<AnalisarResponse | null>(null);

  const [busy, setBusy] = useState(false);
  const [iaError, setIaError] = useState<string | null>(null);

  async function gerarConteudo() {
    setBusy(true); setIaError(null);
    try {
      const r = await api.post<GerarConteudoResponse>('/campanhas/ia/gerar-conteudo', {
        canal: campanha.canal,
        objetivo: objetivo.trim(),
        tom,
      });
      setGerarResult(r);
    } catch (err) {
      setIaError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  async function otimizarMensagem() {
    setBusy(true); setIaError(null);
    try {
      const canal = campanha.canal === 'WHATSAPP_EMAIL'
        ? (campanha.mensagemWa ? 'WHATSAPP' : 'EMAIL')
        : campanha.canal as 'WHATSAPP' | 'EMAIL';
      const r = await api.post<OtimizarResponse>('/campanhas/ia/otimizar', {
        canal,
        mensagem: otimizarTexto.trim(),
        assunto: campanha.assunto,
        objetivo: campanha.objetivo,
      });
      setOtimizarResult(r);
    } catch (err) {
      setIaError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  async function sugerirSegmento() {
    setBusy(true); setIaError(null);
    try {
      const r = await api.post<SugerirSegmentoResponse>('/campanhas/ia/sugerir-segmento', {
        objetivo: sugerirObj.trim(),
      });
      setSugerirResult(r);
    } catch (err) {
      setIaError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  async function analisarResultado() {
    setBusy(true); setIaError(null);
    try {
      const r = await api.get<AnalisarResponse>(`/campanhas/${campanha.id}/ia/analisar`);
      setAnalisarResult(r);
    } catch (err) {
      setIaError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  const IA_TOOLS = [
    { key: 'gerar', label: '✍ Gerar conteúdo', disabled: false },
    { key: 'otimizar', label: '⚡ Otimizar mensagem', disabled: !campanha.mensagemWa && !campanha.mensagemEmail },
    { key: 'sugerir', label: '🎯 Sugerir segmento', disabled: false },
    { key: 'analisar', label: '📊 Analisar resultado', disabled: campanha.status !== 'ENVIADA' },
  ] as const;

  return (
    <div>
      <p style={{ marginTop: 0, fontSize: 13, color: colors.muted }}>
        Ferramentas de IA pra criação e análise de campanhas. Usa OpenAI (chave da empresa ou do usuário logado).
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '1rem' }}>
        {IA_TOOLS.map((tool) => (
          <button
            key={tool.key}
            type="button"
            data-testid={`ia-${tool.key}`}
            disabled={tool.disabled}
            onClick={() => { setIaMode(tool.key); setIaError(null); }}
            style={{
              ...btnSecondary,
              fontSize: 12,
              opacity: tool.disabled ? 0.4 : 1,
              cursor: tool.disabled ? 'not-allowed' : 'pointer',
              background: iaMode === tool.key ? colors.primaryLight : undefined,
              color: iaMode === tool.key ? colors.primary : undefined,
              borderColor: iaMode === tool.key ? colors.primary : undefined,
            }}
          >
            {tool.label}
          </button>
        ))}
      </div>

      {iaError && (
        <p style={{ color: colors.danger, fontSize: 13, margin: '0 0 0.75rem' }}>{iaError}</p>
      )}

      {/* Gerar conteúdo */}
      {iaMode === 'gerar' && (
        <div style={{ background: '#fafbfc', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '0.875rem' }}>
          <FormField label="Objetivo da campanha" htmlFor="ia-obj">
            <Textarea
              id="ia-obj"
              value={objetivo}
              onChange={(e) => setObjetivo(e.target.value)}
              placeholder="Ex: Reengajar clientes inativos com oferta especial de proteína de soja"
              maxLength={500}
              style={{ minHeight: 60 }}
            />
          </FormField>
          <FormField label="Tom" htmlFor="ia-tom">
            <Select id="ia-tom" value={tom} onChange={(e) => setTom(e.target.value as TomIA)}>
              <option value="amigavel">Amigável</option>
              <option value="formal">Formal</option>
              <option value="urgente">Urgente</option>
              <option value="consultivo">Consultivo</option>
            </Select>
          </FormField>
          <button
            type="button"
            disabled={busy || objetivo.trim().length < 10}
            onClick={gerarConteudo}
            style={{ ...btn, opacity: busy || objetivo.trim().length < 10 ? 0.6 : 1 }}
          >
            {busy ? 'Gerando…' : 'Gerar conteúdo'}
          </button>
          {gerarResult && (
            <div style={{ marginTop: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {gerarResult.mensagemWa && <IAResultBlock label="WhatsApp" text={gerarResult.mensagemWa} />}
              {gerarResult.assunto && <IAResultBlock label="Assunto e-mail" text={gerarResult.assunto} />}
              {gerarResult.mensagemEmail && <IAResultBlock label="Corpo e-mail" text={gerarResult.mensagemEmail} />}
              {gerarResult.variacoes && gerarResult.variacoes.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', marginBottom: 4 }}>Variações</div>
                  {gerarResult.variacoes.map((v, i) => (
                    <IAResultBlock key={i} label={`Variação ${i + 1}`} text={v.mensagemWa ?? v.mensagemEmail ?? JSON.stringify(v)} />
                  ))}
                </div>
              )}
              {(gerarResult.tokensIn || gerarResult.tokensOut) && (
                <p style={{ fontSize: 11, color: colors.muted, margin: 0 }}>
                  Tokens: {gerarResult.tokensIn}↓ {gerarResult.tokensOut}↑
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Otimizar */}
      {iaMode === 'otimizar' && (
        <div style={{ background: '#fafbfc', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '0.875rem' }}>
          <FormField label="Mensagem a otimizar">
            <Textarea
              value={otimizarTexto}
              onChange={(e) => setOtimizarTexto(e.target.value)}
              placeholder="Cole a mensagem atual aqui…"
              maxLength={4096}
              style={{ minHeight: 80 }}
            />
          </FormField>
          <button
            type="button"
            disabled={busy || otimizarTexto.trim().length < 10}
            onClick={otimizarMensagem}
            style={{ ...btn, opacity: busy || otimizarTexto.trim().length < 10 ? 0.6 : 1 }}
          >
            {busy ? 'Otimizando…' : 'Otimizar'}
          </button>
          {otimizarResult && (
            <div style={{ marginTop: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <IAResultBlock label="Versão otimizada" text={otimizarResult.mensagemOtimizada} />
              {otimizarResult.variacoes?.map((v, i) => (
                <IAResultBlock key={i} label={`Variação ${i + 1}`} text={v} />
              ))}
              {otimizarResult.dicas && otimizarResult.dicas.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', marginBottom: 4 }}>Dicas de copywriting</div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: colors.muted }}>
                    {otimizarResult.dicas.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sugerir segmento */}
      {iaMode === 'sugerir' && (
        <div style={{ background: '#fafbfc', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '0.875rem' }}>
          <FormField label="Objetivo" htmlFor="ia-sobj">
            <Textarea
              id="ia-sobj"
              value={sugerirObj}
              onChange={(e) => setSugerirObj(e.target.value)}
              placeholder="Descreva o objetivo da campanha para obter sugestão de segmento…"
              maxLength={500}
              style={{ minHeight: 60 }}
            />
          </FormField>
          <button
            type="button"
            disabled={busy || sugerirObj.trim().length < 10}
            onClick={sugerirSegmento}
            style={{ ...btn, opacity: busy || sugerirObj.trim().length < 10 ? 0.6 : 1 }}
          >
            {busy ? 'Analisando base…' : 'Sugerir segmento'}
          </button>
          {sugerirResult && (
            <div style={{ marginTop: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <IAResultBlock label="Segmento sugerido" text={sugerirResult.segmentoSugerido} />
              {sugerirResult.justificativa && <IAResultBlock label="Justificativa" text={sugerirResult.justificativa} />}
              {sugerirResult.tomIdeal && <p style={{ margin: 0, fontSize: 12 }}>Tom ideal: <strong>{sugerirResult.tomIdeal}</strong></p>}
              {sugerirResult.melhorHorario && <p style={{ margin: 0, fontSize: 12 }}>Melhor horário: <strong>{sugerirResult.melhorHorario}</strong></p>}
              {sugerirResult.tagsRecomendadas && sugerirResult.tagsRecomendadas.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {sugerirResult.tagsRecomendadas.map((t) => (
                    <span key={t} style={badge(colors.primary)}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Analisar resultado */}
      {iaMode === 'analisar' && (
        <div style={{ background: '#fafbfc', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '0.875rem' }}>
          <p style={{ margin: '0 0 0.75rem', fontSize: 13, color: colors.muted }}>
            Analisa os resultados desta campanha e retorna insights acionáveis.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={analisarResultado}
            style={{ ...btn, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Analisando…' : '📊 Analisar agora'}
          </button>
          {analisarResult && (
            <div style={{ marginTop: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {analisarResult.score !== undefined && (
                <div style={{ fontSize: 22, fontWeight: 700, color: analisarResult.score >= 7 ? colors.success : analisarResult.score >= 5 ? colors.warning : colors.danger }}>
                  Score: {analisarResult.score}/10
                </div>
              )}
              {analisarResult.insights.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', marginBottom: 4 }}>Insights</div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 13, lineHeight: 1.6 }}>
                    {analisarResult.insights.map((i, idx) => <li key={idx}>{i}</li>)}
                  </ul>
                </div>
              )}
              {analisarResult.pontosFortres && analisarResult.pontosFortres.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: colors.success, textTransform: 'uppercase', marginBottom: 4 }}>Pontos fortes</div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 13, lineHeight: 1.6 }}>
                    {analisarResult.pontosFortres.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </div>
              )}
              {analisarResult.melhorias && analisarResult.melhorias.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: colors.warning, textTransform: 'uppercase', marginBottom: 4 }}>A melhorar</div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 13, lineHeight: 1.6 }}>
                    {analisarResult.melhorias.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
              {analisarResult.recomendacoes && analisarResult.recomendacoes.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: '#0891b2', textTransform: 'uppercase', marginBottom: 4 }}>Recomendações</div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 13, lineHeight: 1.6 }}>
                    {analisarResult.recomendacoes.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IAResultBlock({ label, text }: { label: string; text: string }) {
  const { success } = useToast();
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(text).then(() => success('Copiado!')).catch(() => {});
          }}
          style={{ ...btnSecondary, fontSize: 10, padding: '2px 8px' }}
        >
          Copiar
        </button>
      </div>
      <pre style={{ margin: 0, padding: '0.625rem', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.5 }}>
        {text}
      </pre>
    </div>
  );
}

// ─── Create modal ─────────────────────────────────────────────────────────────

interface TagLite {
  id: string;
  nome: string;
  clientesCount?: number;
}

function CreateCampanhaModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [canal, setCanal] = useState<CampanhaCanal>('WHATSAPP');
  const [objetivo, setObjetivo] = useState('');
  const [mensagemWa, setMensagemWa] = useState('');
  const [mensagemEmail, setMensagemEmail] = useState('');
  const [assunto, setAssunto] = useState('');
  const [usarIa, setUsarIa] = useState(false);
  const [segTagIds, setSegTagIds] = useState<string[]>([]);
  const [agendado, setAgendado] = useState(false);
  const [agendadoPara, setAgendadoPara] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Lista de tags da empresa pra segmentação
  const tagsQuery = useApiQuery<TagLite[] | { data: TagLite[] }>('/tags');
  const tags: TagLite[] = Array.isArray(tagsQuery.data)
    ? tagsQuery.data
    : tagsQuery.data?.data ?? [];

  const precisaWa = canal !== 'EMAIL';
  const precisaEmail = canal !== 'WHATSAPP';

  /** Substitui merge tags por valores exemplo pro preview. */
  function preview(template: string): string {
    return template
      .replace(/\{\{?\s*nome\s*\}?\}/gi, 'João Silva')
      .replace(/\{\{?\s*empresa\s*\}?\}/gi, 'Acme Ltda')
      .replace(/\{\{?\s*cnpj\s*\}?\}/gi, '12.345.678/0001-99')
      .replace(/\{\{?\s*rep\s*\}?\}/gi, 'Léo (você)');
  }

  function toggleTag(id: string) {
    setSegTagIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    // Validações client-side com mensagens claras
    if (nome.trim().length === 0) {
      setFormError('Informe um nome pra campanha.');
      return;
    }
    if (precisaWa && mensagemWa.trim().length === 0) {
      setFormError('Mensagem WhatsApp é obrigatória pra este canal.');
      return;
    }
    if (precisaEmail && mensagemEmail.trim().length === 0) {
      setFormError('Mensagem de e-mail é obrigatória pra este canal.');
      return;
    }
    if (agendado) {
      if (!agendadoPara) {
        setFormError('Informe data e hora do agendamento.');
        return;
      }
      const d = new Date(agendadoPara);
      if (d.getTime() <= Date.now()) {
        setFormError('Agendamento deve ser uma data futura.');
        return;
      }
    }

    setBusy(true);
    setFormError(null);
    const payload: Record<string, unknown> = {
      nome: nome.trim(),
      canal,
      usarIaPersonalizacao: usarIa,
    };
    if (objetivo.trim()) payload.objetivo = objetivo.trim();
    if (precisaWa) payload.mensagemWa = mensagemWa.trim();
    if (precisaEmail) {
      payload.mensagemEmail = mensagemEmail.trim();
      if (assunto.trim()) payload.assunto = assunto.trim();
    }
    if (segTagIds.length > 0) payload.segTagIds = segTagIds;
    if (agendado && agendadoPara) {
      payload.agendadoPara = new Date(agendadoPara).toISOString();
    }
    try {
      const r = await api.post<{ id: string }>('/campanhas', payload);
      onSaved(r.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Falha ao criar campanha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={640}
      title="Nova campanha"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancelar</button>
          <button
            type="submit"
            form="campanha-form"
            data-testid="campanha-save"
            disabled={busy}
            style={{ ...btn, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Criando…' : agendado ? 'Agendar' : 'Criar (rascunho)'}
          </button>
        </>
      }
    >
      <form id="campanha-form" onSubmit={submit}>
        <FormField label="Nome" htmlFor="c-nome" required>
          <Input
            id="c-nome"
            data-testid="campanha-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            maxLength={120}
            autoFocus
          />
        </FormField>

        <FormField label="Canal" htmlFor="c-canal">
          <Select id="c-canal" value={canal} onChange={(e) => setCanal(e.target.value as CampanhaCanal)}>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">E-mail</option>
            <option value="WHATSAPP_EMAIL">WhatsApp + E-mail</option>
          </Select>
        </FormField>

        <FormField label="Objetivo" htmlFor="c-obj" hint="Contexto para análise de IA">
          <Textarea
            id="c-obj"
            value={objetivo}
            onChange={(e) => setObjetivo(e.target.value)}
            placeholder="Ex: Reengajar clientes com mais de 60 dias sem pedido…"
            maxLength={500}
            style={{ minHeight: 50 }}
          />
        </FormField>

        {precisaWa && (
          <FormField label="Mensagem WhatsApp" htmlFor="c-wa" required>
            <Textarea
              id="c-wa"
              value={mensagemWa}
              onChange={(e) => setMensagemWa(e.target.value)}
              placeholder="Olá {nome}, temos uma oferta especial pra você…"
              maxLength={4096}
              style={{ minHeight: 80 }}
              required
            />
          </FormField>
        )}

        {precisaEmail && (
          <>
            <FormField label="Assunto do e-mail" htmlFor="c-assunto">
              <Input
                id="c-assunto"
                value={assunto}
                onChange={(e) => setAssunto(e.target.value)}
                maxLength={200}
                placeholder="Oferta especial pra você!"
              />
            </FormField>
            <FormField label="Corpo do e-mail" htmlFor="c-email" required>
              <Textarea
                id="c-email"
                value={mensagemEmail}
                onChange={(e) => setMensagemEmail(e.target.value)}
                placeholder="Prezado {nome}, ..."
                style={{ minHeight: 100 }}
                required
              />
            </FormField>
          </>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 13, marginTop: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            data-testid="campanha-ia"
            checked={usarIa}
            onChange={(e) => setUsarIa(e.target.checked)}
          />
          ✨ Personalização IA por destinatário (usa tokens OpenAI)
        </label>

        {/* ── Destinatários (segmentação por tags) ───────────────────── */}
        <FormField label="Destinatários" hint="Sem tags selecionadas = toda a base ativa da empresa">
          {tags.length === 0 ? (
            <span style={{ fontSize: 12, color: colors.muted, fontStyle: 'italic' }}>
              Nenhuma tag cadastrada — campanha será enviada pra toda a base
            </span>
          ) : (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.375rem',
                maxHeight: 110,
                overflowY: 'auto',
                padding: '0.25rem 0',
              }}
              data-testid="campanha-tags"
            >
              {tags.map((t) => {
                const selected = segTagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    data-testid={`tag-pill-${t.id}`}
                    style={{
                      fontSize: 12,
                      padding: '0.25rem 0.625rem',
                      borderRadius: 999,
                      border: `1px solid ${selected ? colors.primary : colors.border}`,
                      background: selected ? colors.primaryLight ?? '#ecebf3' : 'transparent',
                      color: selected ? colors.primary : colors.text,
                      cursor: 'pointer',
                      fontWeight: selected ? 600 : 400,
                    }}
                  >
                    {t.nome}
                    {t.clientesCount !== undefined && (
                      <span style={{ marginLeft: 4, opacity: 0.6 }}>· {t.clientesCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </FormField>

        {/* ── Agendamento ──────────────────────────────────────────── */}
        <FormField label="Quando enviar">
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input
                type="radio"
                name="agendamento"
                checked={!agendado}
                onChange={() => setAgendado(false)}
                data-testid="campanha-agora"
              />
              Agora (rascunho → disparar manual depois)
            </label>
            <label style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input
                type="radio"
                name="agendamento"
                checked={agendado}
                onChange={() => setAgendado(true)}
                data-testid="campanha-agendar"
              />
              Agendar
            </label>
            {agendado && (
              <Input
                type="datetime-local"
                data-testid="campanha-data"
                value={agendadoPara}
                onChange={(e) => setAgendadoPara(e.target.value)}
                style={{ maxWidth: 220 }}
              />
            )}
          </div>
        </FormField>

        {/* ── Preview com merge tags substituídos ──────────────────── */}
        {(precisaWa && mensagemWa.trim()) || (precisaEmail && mensagemEmail.trim()) ? (
          <FormField label="Preview" hint="Como o cliente vai receber (com merge tags substituídos)">
            <div
              data-testid="campanha-preview"
              style={{
                background: colors.bgAlt,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: '0.75rem',
                fontSize: 13,
                whiteSpace: 'pre-wrap',
                color: colors.text,
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {precisaWa && mensagemWa.trim() && (
                <>
                  <div style={{ fontSize: 10, color: colors.muted, marginBottom: 4, fontWeight: 600 }}>
                    📱 WhatsApp
                  </div>
                  <div>{preview(mensagemWa)}</div>
                </>
              )}
              {precisaWa && precisaEmail && mensagemWa.trim() && mensagemEmail.trim() && (
                <hr style={{ margin: '0.5rem 0', border: 0, borderTop: `1px solid ${colors.border}` }} />
              )}
              {precisaEmail && mensagemEmail.trim() && (
                <>
                  <div style={{ fontSize: 10, color: colors.muted, marginBottom: 4, fontWeight: 600 }}>
                    ✉️ E-mail
                  </div>
                  {assunto.trim() && (
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      {preview(assunto)}
                    </div>
                  )}
                  <div>{preview(mensagemEmail)}</div>
                </>
              )}
            </div>
          </FormField>
        ) : null}

        {formError && <p style={{ color: colors.danger, fontSize: 13, marginTop: '0.5rem' }}>{formError}</p>}
      </form>
    </Modal>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: colors.muted, marginBottom: 2, letterSpacing: 0.3, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

function Stat({ label, value, color = colors.text }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#fafbfc', border: `1px solid ${colors.border}`, borderRadius: 6, padding: '0.625rem' }}>
      <div style={{ fontSize: 9, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}
