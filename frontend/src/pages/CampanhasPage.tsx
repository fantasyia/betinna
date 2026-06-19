import { useMemo, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatPercent } from '@/lib/masks';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { usePermission } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { CrmTabs } from '@/components/CrmTabs';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Dialog } from '@/components/ui';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/hooks/useConfirm';
import { cn } from '@/lib/cn';

// ─── Style tokens (Tailwind — equivalentes exatos do styles.ts legado) ─────────

// Botões: traduções pixel-idênticas dos objetos btn/btnSecondary/btnDanger.
const BTN =
  'bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]';
const BTN_SECONDARY =
  'bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]';
const BTN_DANGER =
  'bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]';
// Card: bg-surface border border-border rounded-[10px] p-6.
const CARD = 'bg-surface border border-border rounded-[10px] p-6';
// badge() com cor DINÂMICA (CSS var em runtime) → classes de layout + inline color-mix.
const BADGE_BASE =
  'inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] border';
function badgeStyle(color: string): React.CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    color,
    borderColor: `color-mix(in srgb, ${color} 19%, transparent)`,
  };
}

// CSS vars (mesmos tokens do colors.* legado) — usados em estilos com cor dinâmica.
const cssVar = {
  bgAlt: 'var(--bg-alt)',
  surface: 'var(--surface)',
  border: 'var(--border)',
  text: 'var(--text)',
  muted: 'var(--muted)',
  primary: 'var(--primary)',
  primaryLight: 'var(--primary-light)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  magenta: 'var(--magenta)',
  channelWhatsapp: '#25d366',
};

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
  iniciadoEm?: string | null;
  finalizadoEm?: string | null;
  _count?: { destinatarios: number };
  criadoEm: string;
  atualizadoEm: string;
}

interface CampanhaDestinatarioLite {
  id: string;
  clienteId: string;
  cliente?: { nome: string } | null;
  email?: string | null;
  telefone?: string | null;
  status: 'PENDENTE' | 'ENVIADO' | 'LIDO' | 'ERRO';
  erro?: string | null;
  enviadoEm?: string | null;
  lido: boolean;
  lidoEm?: string | null;
}

interface CampanhaDetail extends Campanha {
  mensagemWa?: string | null;
  mensagemEmail?: string | null;
  assunto?: string | null;
  segTagIds?: string[];
  segRepIds?: string[];
  segClienteIds?: string[];
  destinatarios?: CampanhaDestinatarioLite[];
}

/**
 * Métricas de campanha — alinhado com o que o backend retorna em
 * GET /campanhas/:id/metricas. As taxas vêm em INTEIRO 0-100, NÃO em fração.
 * (Fix B5 — antes o frontend esperava nomes errados e tratava taxas como
 * fração, causando 'undefined' e 'NaN%' nos cards.)
 */
interface Metricas {
  total: number;
  pendentes: number;
  enviados: number;
  lidos: number;
  erros: number;
  /** 0-100 (inteiro) */
  taxaEnvio: number;
  /** 0-100 (inteiro) */
  taxaLeitura: number;
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

// Alinhado com MensagemOtimizada do backend (campanha-ia.service.ts).
interface OtimizarResponse {
  melhorada: string;
  variacoes?: string[];
  dicas?: string[];
}

// Alinhado com SegmentoSugerido do backend (campanha-ia.service.ts).
interface SugerirSegmentoResponse {
  justificativa?: string;
  segmentosTextuais?: string[];
  tagIds?: string[];
  tonRecomendado?: string;
  estimativaAlcance?: number;
  melhorHorario?: string;
}

// Alinhado com AnaliseResultado do backend (campanha-ia.service.ts).
interface AnalisarResponse {
  resumoExecutivo?: string;
  pontosFortes?: string[];
  pontosAMelhorar?: string[];
  recomendacoes?: string[];
  proximasCampanhas?: string[];
  scorePerformance?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<CampanhaStatus, string> = {
  RASCUNHO: cssVar.muted,
  AGENDADA: cssVar.info,
  ENVIANDO: cssVar.warning,
  ENVIADA: cssVar.success,
  PAUSADA: cssVar.magenta,
  CANCELADA: cssVar.danger,
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
  WHATSAPP: cssVar.channelWhatsapp,
  EMAIL: cssVar.info,
  WHATSAPP_EMAIL: cssVar.magenta,
};

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}
/**
 * Formata um número 0-100 como percentual (1 casa decimal).
 * Robusto contra `undefined`/`NaN` — sempre retorna string válida.
 */
function fmtPct(v: number | undefined | null) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return formatPercent(n, 1);
}

/** Nº de destinatários materializados (0 em rascunho → tratado como "sem dado"). */
function destCount(c: { _count?: { destinatarios?: number } }): number | undefined {
  const n = c._count?.destinatarios;
  return n && n > 0 ? n : undefined;
}

/**
 * Gera e baixa um CSV com os resultados (destinatários) da campanha — feito no
 * client a partir do payload do detalhe (não precisa de endpoint extra).
 */
function exportarResultadosCsv(c: CampanhaDetail): void {
  const linhas = c.destinatarios ?? [];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['cliente', 'email', 'telefone', 'status', 'enviado_em', 'lido', 'erro'];
  const body = linhas.map((d) =>
    [d.cliente?.nome ?? d.clienteId, d.email, d.telefone, d.status, d.enviadoEm, d.lido ? 'sim' : 'não', d.erro]
      .map(esc)
      .join(','),
  );
  // BOM (U+FEFF) pro Excel abrir UTF-8 certinho.
  const csv = '﻿' + [head.join(','), ...body].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `campanha-${c.nome.replace(/[^\w.-]+/g, '_')}-resultados.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CampanhasPage() {
  const canCreatePerm = usePermission('campanhas.create');
  const canEditPerm = usePermission('campanhas.edit');
  const canCreate = canCreatePerm || canEditPerm;
  const canManage = usePermission('campanhas.manage');
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
      toast.error('Falha na operação', apiErrorMessage(err));
    }
  }

  const columns: Column<Campanha>[] = [
    {
      key: 'nome',
      header: 'Campanha',
      render: (c) => (
        <div>
          <div className="font-semibold">{c.nome}</div>
          {c.objetivo && (
            <div className="text-[11px] text-muted max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap">
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
        <span className={BADGE_BASE} style={badgeStyle(CANAL_COLOR[c.canal])}>{CANAL_LABEL[c.canal]}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => (
        <span className={BADGE_BASE} style={badgeStyle(STATUS_COLOR[c.status])}>{STATUS_LABEL[c.status]}</span>
      ),
    },
    {
      key: 'alcance',
      header: 'Destinatários',
      render: (c) => {
        const n = destCount(c);
        return n !== undefined ? String(n) : <em className="text-muted">—</em>;
      },
    },
    {
      key: 'agendado',
      header: 'Agendado / Enviado',
      render: (c) => {
        const enviado = c.finalizadoEm ?? c.iniciadoEm;
        return enviado ? fmtDate(enviado) : c.agendadoPara ? fmtDate(c.agendadoPara) : '—';
      },
    },
    {
      key: 'ia',
      header: 'IA',
      render: (c) =>
        c.usarIaPersonalizacao ? (
          <span className={cn(BADGE_BASE, 'text-[9px]')} style={badgeStyle(cssVar.magenta)}>✨ Personalizada</span>
        ) : null,
    },
    {
      key: 'actions',
      header: '',
      render: (c) => (
        <div className="flex gap-1">
          <button
            type="button"
            data-testid={`campanha-open-${c.id}`}
            onClick={() => setSelected(c.id)}
            className={cn(BTN_SECONDARY, 'px-2.5 py-1 text-[12px]')}
          >
            Abrir
          </button>
          {canManage && c.status === 'RASCUNHO' && (
            <button
              type="button"
              data-testid={`campanha-disparar-${c.id}`}
              onClick={() => callAction(c.id, 'disparar')}
              className={cn(BTN, 'px-2.5 py-1 text-[12px]')}
            >
              ▶ Disparar
            </button>
          )}
          {canManage && c.status === 'ENVIANDO' && (
            <button
              type="button"
              data-testid={`campanha-pausar-${c.id}`}
              onClick={() => callAction(c.id, 'pausar')}
              className={cn(BTN_SECONDARY, 'px-2.5 py-1 text-[12px]')}
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
            className={BTN}
          >
            + Nova campanha
          </button>
        ) : undefined
      }
    >
      <CrmTabs />
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
          {/* Normaliza defaults — proteção contra payload incompleto (mesmo padrão das Métricas). */}
          <StatBox label="Total" value={String(resumo.total ?? 0)} />
          <StatBox label="Rascunhos" value={String(resumo.rascunhos ?? 0)} />
          <StatBox label="Agendadas" value={String(resumo.agendadas ?? 0)} color={cssVar.info} />
          <StatBox label="Enviando" value={String(resumo.enviando ?? 0)} color={cssVar.warning} />
          <StatBox label="Enviadas" value={String(resumo.enviadas ?? 0)} color={cssVar.success} />
          <StatBox label="Alcance 30d" value={String(resumo.alcanceUltimos30d ?? 0)} color={cssVar.magenta} />
        </div>
      )}

      <div className={CARD}>
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

function StatBox({ label, value, color = cssVar.text }: { label: string; value: string; color?: string }) {
  return (
    <div className={cn(CARD, 'p-3')}>
      <div className="text-[10px] text-muted font-bold uppercase tracking-[0.4px]">
        {label}
      </div>
      <div className="text-[22px] font-bold mt-1" style={{ color }}>{value}</div>
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
  const { data: metricas, refetch: refetchMetricas } = useApiQuery<Metricas>(`/campanhas/${id}/metricas`);
  const [tab, setTab] = useState<DetailTab>('info');
  const [acting, setActing] = useState(false);
  const [confirmAsync, ConfirmDialog] = useConfirm();

  async function callAction(action: 'disparar' | 'pausar' | 'cancelar' | 'reenviar-erros') {
    setActing(true);
    try {
      await api.post(`/campanhas/${id}/${action}`);
      const labelMap = {
        disparar: 'disparada',
        pausar: 'pausada',
        cancelar: 'cancelada',
        'reenviar-erros': 'reenfileirada',
      };
      toast.success(`Campanha ${labelMap[action]}`);
      refetch();
      refetchMetricas();
      onChanged();
    } catch (err) {
      toast.error('Falha', apiErrorMessage(err));
    } finally {
      setActing(false);
    }
  }

  const c = data;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={c?.nome ?? 'Campanha'}
      footer={
        <div className="flex gap-2 justify-between w-full">
          <div className="flex gap-1.5">
            {canManage && c?.status === 'RASCUNHO' && (
              <button
                type="button"
                data-testid="campanha-disparar"
                disabled={acting}
                onClick={() => callAction('disparar')}
                className={BTN}
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
                className={BTN_SECONDARY}
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
                className={BTN_DANGER}
              >
                Cancelar
              </button>
            )}
            {canManage && c?.status === 'ENVIADA' && (metricas?.erros ?? 0) > 0 && (
              <button
                type="button"
                data-testid="campanha-reenviar-erros"
                disabled={acting}
                onClick={() => callAction('reenviar-erros')}
                className={BTN_SECONDARY}
              >
                ↻ Reenviar falhas ({metricas?.erros})
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Fechar</button>
        </div>
      }
    >
      {/* Tabs */}
      <div
        role="tablist"
        className="flex gap-1 mb-4 border-b border-border pb-2"
      >
        {(['info', 'metricas', 'ia'] as DetailTab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'bg-none border-none text-[13px] px-3 py-1 cursor-pointer font-[inherit] mb-[-9px]',
              tab === t ? 'border-b-2 border-primary text-primary font-semibold' : 'border-b-2 border-transparent text-muted font-normal',
            )}
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
                <header className="flex gap-2 flex-wrap mb-4">
                  <span className={BADGE_BASE} style={badgeStyle(STATUS_COLOR[c.status])}>{STATUS_LABEL[c.status]}</span>
                  <span className={BADGE_BASE} style={badgeStyle(CANAL_COLOR[c.canal])}>{CANAL_LABEL[c.canal]}</span>
                  {c.usarIaPersonalizacao && (
                    <span className={BADGE_BASE} style={badgeStyle(cssVar.magenta)}>✨ IA personalização</span>
                  )}
                </header>

                {c.objetivo && (
                  <div className="mb-4 p-3 bg-bg-alt rounded-md border border-border">
                    <div className="text-[11px] text-muted font-semibold uppercase mb-1">Objetivo</div>
                    <p className="m-0 text-[13px]">{c.objetivo}</p>
                  </div>
                )}

                <dl className="grid grid-cols-2 gap-3 text-[13px] mb-4">
                  <Info label="Criado em">{fmtDate(c.criadoEm)}</Info>
                  <Info label="Agendado para">{fmtDate(c.agendadoPara)}</Info>
                  <Info label="Enviado em">{fmtDate(c.finalizadoEm ?? c.iniciadoEm)}</Info>
                  <Info label="Destinatários">{destCount(c) !== undefined ? String(destCount(c)) : '—'}</Info>
                </dl>

                {(c.mensagemWa || c.mensagemEmail) && (
                  <div>
                    {c.mensagemWa && (
                      <div className="mb-3">
                        <div className="text-[11px] text-muted font-semibold uppercase mb-1">
                          Mensagem WhatsApp
                        </div>
                        <pre className="m-0 p-3 bg-bg-alt border border-border rounded-md text-[13px] whitespace-pre-wrap font-[inherit]">
                          {c.mensagemWa}
                        </pre>
                      </div>
                    )}
                    {c.assunto && (
                      <div className="mb-2">
                        <div className="text-[11px] text-muted font-semibold uppercase mb-1">
                          Assunto e-mail
                        </div>
                        <p className="m-0 px-3 py-2 bg-bg-alt border border-border rounded-md text-[13px]">
                          {c.assunto}
                        </p>
                      </div>
                    )}
                    {c.mensagemEmail && (
                      <div>
                        <div className="text-[11px] text-muted font-semibold uppercase mb-1">
                          Corpo e-mail
                        </div>
                        <pre className="m-0 p-3 bg-bg-alt border border-border rounded-md text-[13px] whitespace-pre-wrap font-[inherit] max-h-[200px] overflow-y-auto">
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
                {c.destinatarios && c.destinatarios.length > 0 && (
                  <div className="flex justify-end mb-2">
                    <button
                      type="button"
                      data-testid="campanha-export-csv"
                      onClick={() => exportarResultadosCsv(c)}
                      className={cn(BTN_SECONDARY, 'text-[12px]')}
                    >
                      ⬇ Exportar CSV
                    </button>
                  </div>
                )}
                {metricas ? (
                  (() => {
                    // Normaliza defaults — proteção contra payload incompleto.
                    const total = metricas.total ?? 0;
                    const enviados = metricas.enviados ?? 0;
                    const erros = metricas.erros ?? 0;
                    const lidos = metricas.lidos ?? 0;
                    const taxaEnvio = metricas.taxaEnvio ?? 0;
                    const taxaLeitura = metricas.taxaLeitura ?? 0;
                    // Backend não retorna taxaErro — calcula no client (0-100).
                    const taxaErro = total > 0 ? (erros / total) * 100 : 0;
                    return (
                      <>
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3 mb-4">
                          <Stat label="Destinatários" value={String(total)} />
                          <Stat label="Enviados" value={String(enviados)} color={cssVar.success} />
                          <Stat label="Falhas" value={String(erros)} color={erros > 0 ? cssVar.danger : cssVar.muted} />
                          <Stat label="Lidos" value={String(lidos)} color={cssVar.info} />
                          <Stat label="Taxa envio" value={fmtPct(taxaEnvio)} color={cssVar.success} />
                          <Stat label="Taxa leitura" value={fmtPct(taxaLeitura)} color={cssVar.info} />
                          <Stat label="Taxa erro" value={fmtPct(taxaErro)} color={taxaErro > 5 ? cssVar.danger : cssVar.muted} />
                        </div>
                        {total === 0 && (
                          <p className="text-muted text-[13px] mt-0">
                            Campanha ainda não disparada ou sem destinatários.
                          </p>
                        )}
                      </>
                    );
                  })()
                ) : (
                  <p className="text-muted">Carregando métricas…</p>
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
    </Dialog>
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

  // Tags da empresa pra mapear os tagIds sugeridos pela IA → nome legível.
  const tagsQuery = useApiQuery<TagLite[] | { data: TagLite[] }>('/tags');
  const tags: TagLite[] = Array.isArray(tagsQuery.data)
    ? tagsQuery.data
    : tagsQuery.data?.data ?? [];
  const tagNome = (id: string) => tags.find((t) => t.id === id)?.nome ?? id;

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
      setIaError(apiErrorMessage(err));
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
      setIaError(apiErrorMessage(err));
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
      setIaError(apiErrorMessage(err));
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
      setIaError(apiErrorMessage(err));
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
      <p className="mt-0 text-[13px] text-muted">
        Ferramentas de IA pra criação e análise de campanhas. Usa OpenAI (chave da empresa ou do usuário logado).
      </p>

      <div className="flex gap-1.5 flex-wrap mb-4">
        {IA_TOOLS.map((tool) => (
          <button
            key={tool.key}
            type="button"
            data-testid={`ia-${tool.key}`}
            disabled={tool.disabled}
            onClick={() => { setIaMode(tool.key); setIaError(null); }}
            className={cn(BTN_SECONDARY, 'text-[12px]')}
            style={{
              opacity: tool.disabled ? 0.4 : 1,
              cursor: tool.disabled ? 'not-allowed' : 'pointer',
              background: iaMode === tool.key ? cssVar.primaryLight : undefined,
              color: iaMode === tool.key ? cssVar.primary : undefined,
              borderColor: iaMode === tool.key ? cssVar.primary : undefined,
            }}
          >
            {tool.label}
          </button>
        ))}
      </div>

      {iaError && (
        <p className="text-danger text-[13px] m-0 mb-3">{iaError}</p>
      )}

      {/* Gerar conteúdo */}
      {iaMode === 'gerar' && (
        <div className="bg-bg-alt border border-border rounded-lg p-3.5">
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
            className={BTN}
            style={{ opacity: busy || objetivo.trim().length < 10 ? 0.6 : 1 }}
          >
            {busy ? 'Gerando…' : 'Gerar conteúdo'}
          </button>
          {gerarResult && (
            <div className="mt-3.5 flex flex-col gap-2">
              {gerarResult.mensagemWa && <IAResultBlock label="WhatsApp" text={gerarResult.mensagemWa} />}
              {gerarResult.assunto && <IAResultBlock label="Assunto e-mail" text={gerarResult.assunto} />}
              {gerarResult.mensagemEmail && <IAResultBlock label="Corpo e-mail" text={gerarResult.mensagemEmail} />}
              {gerarResult.variacoes && gerarResult.variacoes.length > 0 && (
                <div>
                  <div className="text-[11px] text-muted uppercase mb-1">Variações</div>
                  {gerarResult.variacoes.map((v, i) => (
                    <IAResultBlock key={i} label={`Variação ${i + 1}`} text={v.mensagemWa ?? v.mensagemEmail ?? JSON.stringify(v)} />
                  ))}
                </div>
              )}
              {(gerarResult.tokensIn || gerarResult.tokensOut) && (
                <p className="text-[11px] text-muted m-0">
                  Tokens: {gerarResult.tokensIn}↓ {gerarResult.tokensOut}↑
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Otimizar */}
      {iaMode === 'otimizar' && (
        <div className="bg-bg-alt border border-border rounded-lg p-3.5">
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
            className={BTN}
            style={{ opacity: busy || otimizarTexto.trim().length < 10 ? 0.6 : 1 }}
          >
            {busy ? 'Otimizando…' : 'Otimizar'}
          </button>
          {otimizarResult && (
            <div className="mt-3.5 flex flex-col gap-2">
              <IAResultBlock label="Versão otimizada" text={otimizarResult.melhorada} />
              {otimizarResult.variacoes?.map((v, i) => (
                <IAResultBlock key={i} label={`Variação ${i + 1}`} text={v} />
              ))}
              {otimizarResult.dicas && otimizarResult.dicas.length > 0 && (
                <div>
                  <div className="text-[11px] text-muted uppercase mb-1">Dicas de copywriting</div>
                  <ul className="m-0 pl-4 text-[12px] text-muted">
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
        <div className="bg-bg-alt border border-border rounded-lg p-3.5">
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
            className={BTN}
            style={{ opacity: busy || sugerirObj.trim().length < 10 ? 0.6 : 1 }}
          >
            {busy ? 'Analisando base…' : 'Sugerir segmento'}
          </button>
          {sugerirResult && (
            <div className="mt-3.5 flex flex-col gap-2">
              {sugerirResult.segmentosTextuais && sugerirResult.segmentosTextuais.length > 0 && (
                <IAResultBlock label="Segmentos sugeridos" text={sugerirResult.segmentosTextuais.join('\n')} />
              )}
              {sugerirResult.justificativa && <IAResultBlock label="Justificativa" text={sugerirResult.justificativa} />}
              {sugerirResult.tonRecomendado && <p className="m-0 text-[12px]">Tom ideal: <strong>{sugerirResult.tonRecomendado}</strong></p>}
              {sugerirResult.melhorHorario && <p className="m-0 text-[12px]">Melhor horário: <strong>{sugerirResult.melhorHorario}</strong></p>}
              {sugerirResult.estimativaAlcance !== undefined && sugerirResult.estimativaAlcance > 0 && (
                <p className="m-0 text-[12px]">Estimativa de alcance: <strong>{sugerirResult.estimativaAlcance}</strong> clientes</p>
              )}
              {sugerirResult.tagIds && sugerirResult.tagIds.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {sugerirResult.tagIds.map((id) => (
                    <span key={id} className={BADGE_BASE} style={badgeStyle(cssVar.primary)}>{tagNome(id)}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Analisar resultado */}
      {iaMode === 'analisar' && (
        <div className="bg-bg-alt border border-border rounded-lg p-3.5">
          <p className="m-0 mb-3 text-[13px] text-muted">
            Analisa os resultados desta campanha e retorna insights acionáveis.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={analisarResultado}
            className={BTN}
            style={{ opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Analisando…' : '📊 Analisar agora'}
          </button>
          {analisarResult && (
            <div className="mt-3.5 flex flex-col gap-3">
              {analisarResult.scorePerformance !== undefined && (
                <div className="text-[22px] font-bold" style={{ color: analisarResult.scorePerformance >= 7 ? cssVar.success : analisarResult.scorePerformance >= 5 ? cssVar.warning : cssVar.danger }}>
                  Score: {analisarResult.scorePerformance}/10
                </div>
              )}
              {analisarResult.resumoExecutivo && (
                <div>
                  <div className="text-[11px] text-muted uppercase mb-1">Resumo executivo</div>
                  <p className="m-0 text-[13px] leading-[1.6]">{analisarResult.resumoExecutivo}</p>
                </div>
              )}
              {analisarResult.pontosFortes && analisarResult.pontosFortes.length > 0 && (
                <div>
                  <div className="text-[11px] text-success uppercase mb-1">Pontos fortes</div>
                  <ul className="m-0 pl-4 text-[13px] leading-[1.6]">
                    {analisarResult.pontosFortes.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </div>
              )}
              {analisarResult.pontosAMelhorar && analisarResult.pontosAMelhorar.length > 0 && (
                <div>
                  <div className="text-[11px] text-warning uppercase mb-1">A melhorar</div>
                  <ul className="m-0 pl-4 text-[13px] leading-[1.6]">
                    {analisarResult.pontosAMelhorar.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
              {analisarResult.recomendacoes && analisarResult.recomendacoes.length > 0 && (
                <div>
                  <div className="text-[11px] text-info uppercase mb-1">Recomendações</div>
                  <ul className="m-0 pl-4 text-[13px] leading-[1.6]">
                    {analisarResult.recomendacoes.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {analisarResult.proximasCampanhas && analisarResult.proximasCampanhas.length > 0 && (
                <div>
                  <div className="text-[11px] text-magenta uppercase mb-1">Próximas campanhas</div>
                  <ul className="m-0 pl-4 text-[13px] leading-[1.6]">
                    {analisarResult.proximasCampanhas.map((p, i) => <li key={i}>{p}</li>)}
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
      <div className="flex justify-between items-center mb-1">
        <div className="text-[11px] text-muted uppercase font-semibold">{label}</div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(text).then(() => success('Copiado!')).catch(() => {});
          }}
          className={cn(BTN_SECONDARY, 'text-[10px] px-2 py-0.5')}
        >
          Copiar
        </button>
      </div>
      <pre className="m-0 p-2.5 bg-surface border border-border rounded-md text-[12px] whitespace-pre-wrap font-[inherit] leading-[1.5]">
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
      setFormError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Nova campanha"
      footer={
        <>
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancelar</button>
          <button
            type="submit"
            form="campanha-form"
            data-testid="campanha-save"
            disabled={busy}
            className={BTN}
            style={{ opacity: busy ? 0.6 : 1 }}
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

        <label className="flex items-center gap-2 text-[13px] mt-2 cursor-pointer">
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
            <span className="text-[12px] text-muted italic">
              Nenhuma tag cadastrada — campanha será enviada pra toda a base
            </span>
          ) : (
            <div
              className="flex flex-wrap gap-1.5 max-h-[110px] overflow-y-auto py-1"
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
                    className={cn(
                      'text-[12px] px-2.5 py-1 rounded-full border cursor-pointer',
                      selected ? 'font-semibold' : 'font-normal',
                    )}
                    style={{
                      borderColor: selected ? cssVar.primary : cssVar.border,
                      background: selected ? cssVar.primaryLight ?? '#ecebf3' : 'transparent',
                      color: selected ? cssVar.primary : cssVar.text,
                    }}
                  >
                    {t.nome}
                    {t.clientesCount !== undefined && (
                      <span className="ml-1 opacity-60">· {t.clientesCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </FormField>

        {/* ── Agendamento ──────────────────────────────────────────── */}
        <FormField label="Quando enviar">
          <div className="flex gap-2 items-center flex-wrap">
            <label className="flex gap-1.5 items-center text-[13px] cursor-pointer">
              <input
                type="radio"
                name="agendamento"
                checked={!agendado}
                onChange={() => setAgendado(false)}
                data-testid="campanha-agora"
              />
              Agora (rascunho → disparar manual depois)
            </label>
            <label className="flex gap-1.5 items-center text-[13px] cursor-pointer">
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
              className="bg-bg-alt border border-border rounded-lg p-3 text-[13px] whitespace-pre-wrap text-text max-h-[200px] overflow-y-auto"
            >
              {precisaWa && mensagemWa.trim() && (
                <>
                  <div className="text-[10px] text-muted mb-1 font-semibold">
                    📱 WhatsApp
                  </div>
                  <div>{preview(mensagemWa)}</div>
                </>
              )}
              {precisaWa && precisaEmail && mensagemWa.trim() && mensagemEmail.trim() && (
                <hr className="my-2 border-0 border-t border-border" />
              )}
              {precisaEmail && mensagemEmail.trim() && (
                <>
                  <div className="text-[10px] text-muted mb-1 font-semibold">
                    ✉️ E-mail
                  </div>
                  {assunto.trim() && (
                    <div className="text-[12px] font-semibold mb-1">
                      {preview(assunto)}
                    </div>
                  )}
                  <div>{preview(mensagemEmail)}</div>
                </>
              )}
            </div>
          </FormField>
        ) : null}

        {formError && <p className="text-danger text-[13px] mt-2">{formError}</p>}
      </form>
    </Dialog>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-muted mb-0.5 tracking-[0.3px] font-semibold">
        {label}
      </div>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

function Stat({ label, value, color = cssVar.text }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-alt border border-border rounded-md p-2.5">
      <div className="text-[9px] text-muted uppercase tracking-[0.4px] font-bold">{label}</div>
      <div className="text-[18px] font-bold mt-0.5" style={{ color }}>{value}</div>
    </div>
  );
}
