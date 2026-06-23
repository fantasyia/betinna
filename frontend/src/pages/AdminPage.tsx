import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { SistemaTabs } from '@/components/SistemaTabs';
import { StateView } from '@/components/StateView';
import { Table, type Column } from '@/components/Table';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/hooks/useConfirm';
import { cn } from '@/lib/cn';
import { formatNumero, formatPercent } from '@/lib/masks';

/**
 * Painel Admin — apenas ADMIN.
 *
 * Centraliza ferramentas administrativas:
 *  - System status (versão do backend, ambiente, uptime)
 *  - Dead-letter queue (jobs que falharam após max retries)
 *  - Quick links: usuários, empresas, permissões, integrações
 *
 * Nota: audit log viewer ficou pra próxima fase — backend ainda não expõe
 * endpoint /audit-log (registros existem na DB mas sem API pública).
 */

interface VersionInfo {
  version: string;
  name: string;
  nodeEnv: string;
  railwayEnv: string;
  serviceType: string;
  buildTimestamp: string;
}

interface HealthInfo {
  status: string;
  timestamp: string;
  uptime: number;
}

interface DeadLetterJob {
  id: string;
  queue: string;
  jobName: string;
  failedReason: string;
  attemptsMade: number;
  data: unknown;
  failedAt: string;
}

function fmtUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${Math.floor(seconds % 60)}s`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

export default function AdminPage() {
  return (
    <PageLayout title="Painel Admin">
      <SistemaTabs />
      <p className="text-muted mt-0 text-[14px]">
        Ferramentas operacionais e atalhos restritos ao papel ADMIN.
      </p>

      <SystemStatus />
      <DbHealthSection />
      <CronLatencySection />
      <BackupSection />
      <AuditLogSection />
      <DeadLetterSection />
      <PermissoesGranularesSection />
      <QuickLinksSection />
    </PageLayout>
  );
}

// ─── System Status ────────────────────────────────────────────────────

function SystemStatus() {
  const version = useApiQuery<VersionInfo>('/version');
  const health = useApiQuery<HealthInfo>('/health');

  return (
    <section className="bg-surface border border-border rounded-[10px] p-6 mb-4">
      <h2 className="mt-0 text-[16px]">📡 Status do sistema</h2>
      <StateView
        loading={version.loading || health.loading}
        error={version.error ?? health.error}
        onRetry={() => {
          version.refetch();
          health.refetch();
        }}
      >
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          <Stat
            label="API status"
            value={health.data?.status === 'ok' ? 'Online' : 'Degraded'}
            color={health.data?.status === 'ok' ? 'var(--success)' : 'var(--danger)'}
          />
          <Stat label="Uptime" value={health.data?.uptime ? fmtUptime(health.data.uptime) : '—'} />
          <Stat label="Versão" value={version.data?.version ?? '—'} />
          <Stat label="Ambiente" value={version.data?.nodeEnv ?? '—'} />
          <Stat label="Service type" value={version.data?.serviceType ?? '—'} />
          <Stat label="Railway env" value={version.data?.railwayEnv || '—'} />
        </div>
        {version.data?.buildTimestamp && (
          <p className="text-[11px] text-muted mt-2">
            Boot: {fmtDate(version.data.buildTimestamp)}
          </p>
        )}
      </StateView>
    </section>
  );
}

function Stat({
  label,
  value,
  color = 'var(--text)',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-bg-alt border border-border rounded-md py-2 px-3">
      <div className="text-[10px] text-muted uppercase tracking-[0.3px] font-semibold">{label}</div>
      <div className="text-[16px] font-semibold mt-0.5 break-words" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

// ─── Latência dos crons agendados ─────────────────────────────────────

interface CronMetricas {
  amostras: number;
  mediaMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** p99 acima da meta de 1 min. */
  alerta: boolean;
}

/** Formata duração em ms → "320ms" / "1,2s" / "1m 5s" (pt-BR). */
function fmtMs(ms: number): string {
  if (ms < 1000) return `${formatNumero(Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${formatNumero(Math.round(s * 10) / 10)}s`;
  const min = Math.floor(s / 60);
  const resto = Math.round(s % 60);
  return `${min}m ${resto}s`;
}

/**
 * Latência de disparo dos fluxos com gatilho "Cron agendado" — atraso entre o
 * horário agendado e o disparo real. Meta: p99 ≤ 1 min. Amostragem das últimas
 * 1000 execuções (cron a cada 1min).
 */
function CronLatencySection() {
  const { data, loading, error, refetch } = useApiQuery<CronMetricas>('/fluxos/cron/metricas');

  return (
    <section className="bg-surface border border-border rounded-[10px] p-6 mb-4">
      <header className="flex items-center justify-between gap-2 mb-1">
        <h2 className="m-0 text-[16px]">⏱️ Latência dos crons agendados</h2>
        {data && data.amostras > 0 && (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold border',
              data.alerta
                ? 'bg-danger/12 text-danger border-danger/19'
                : 'bg-success/12 text-success border-success/19',
            )}
          >
            {data.alerta ? '⚠ p99 acima de 1min' : '✓ dentro da meta (p99 ≤ 1min)'}
          </span>
        )}
      </header>
      <p className="text-[11px] text-muted mt-0 mb-3">
        Atraso entre o horário agendado e o disparo real, nas últimas{' '}
        {data?.amostras ?? 0} execuções.
      </p>
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && data.amostras === 0 ? (
          <p className="text-[13px] text-muted m-0">
            Nenhuma execução de cron registrada ainda.
          </p>
        ) : data ? (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}
          >
            <Stat label="Média" value={fmtMs(data.mediaMs)} />
            <Stat label="p50 (mediana)" value={fmtMs(data.p50Ms)} />
            <Stat label="p95" value={fmtMs(data.p95Ms)} />
            <Stat
              label="p99"
              value={fmtMs(data.p99Ms)}
              color={data.alerta ? 'var(--danger)' : 'var(--success)'}
            />
            <Stat label="Máximo" value={fmtMs(data.maxMs)} />
          </div>
        ) : null}
      </StateView>
    </section>
  );
}

// ─── Dead Letter Queue ────────────────────────────────────────────────

function DeadLetterSection() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<DeadLetterJob[] | { data: DeadLetterJob[] }>(
    '/admin/dead-letter',
  );
  const jobs: DeadLetterJob[] = Array.isArray(data) ? data : data?.data ?? [];
  const [confirmAsync, ConfirmDialog] = useConfirm();

  async function retry(jobId: string) {
    const ok = await confirmAsync({
      title: 'Reenviar este job?',
      message:
        'Vai voltar pra queue original. Se a causa raiz não foi corrigida, vai falhar de novo.',
      confirmLabel: 'Reenviar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.post(`/admin/dead-letter/${jobId}/retry`);
      toast.success('Job reenviado', `${jobId} voltou pra queue original`);
      refetch();
    } catch (err) {
      toast.error('Falha ao reenviar', err instanceof ApiError ? err.message : undefined);
    }
  }

  const columns: Column<DeadLetterJob>[] = [
    {
      key: 'job',
      header: 'Job',
      render: (j) => (
        <div>
          <div className="font-semibold text-[13px]">{j.jobName ?? '—'}</div>
          <div className="text-[11px] text-muted">
            <span className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] bg-info/12 text-info border border-info/19">
              {j.queue}
            </span>{' '}
            · {j.attemptsMade} tentativas
          </div>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Motivo da falha',
      render: (j) => (
        <div
          className="text-[12px] text-danger max-w-[380px] overflow-hidden text-ellipsis whitespace-nowrap"
          title={j.failedReason}
        >
          {j.failedReason}
        </div>
      ),
    },
    {
      key: 'failedAt',
      header: 'Falhou em',
      render: (j) => fmtDate(j.failedAt),
    },
    {
      key: 'actions',
      header: '',
      render: (j) => (
        <button
          type="button"
          data-testid={`dlq-retry-${j.id}`}
          onClick={() => retry(j.id)}
          className="bg-primary text-primary-contrast rounded-md py-1 px-2.5 text-[12px] font-semibold cursor-pointer tracking-[-0.1px]"
        >
          Reenviar
        </button>
      ),
    },
  ];

  return (
    <section className="bg-surface border border-border rounded-[10px] p-6 mb-4">
      <header className="flex justify-between items-center mb-3">
        <h2 className="m-0 text-[16px]">💀 Dead-letter queue</h2>
        <button
          type="button"
          data-testid="dlq-refresh"
          onClick={refetch}
          className="bg-surface text-text border border-border-strong rounded-md py-1.5 px-3.5 text-[12px] font-medium cursor-pointer tracking-[-0.1px]"
        >
          Atualizar
        </button>
      </header>
      <p className="text-[12px] text-muted mt-0 mb-3">
        Jobs que falharam após exceder o máximo de retries. Investigar a causa raiz antes
        de retentar — caso contrário falha de novo e consome recursos.
      </p>

      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && jobs.length === 0}
        emptyMessage="🎉 Nenhum job no dead-letter — operação saudável."
        onRetry={refetch}
      >
        <Table data={jobs} columns={columns} rowKey={(j) => j.id} />
      </StateView>
      {ConfirmDialog}
    </section>
  );
}

// Cores oficiais brandbook — usadas inline em destaques (ex: alertas do DB health)
const BRAND = {
  navy: '#201554',
  cyan: '#2bcae5',
  magenta: '#bd1fbf',
  magentaHover: '#a01aa1',
  danger: '#c43c3c',
} as const;

// ─── DB Health (tamanho do Postgres) ──────────────────────────────────

interface DbHealthResponse {
  totalBytes: number;
  totalFmt: string;
  tabelas: Array<{
    tabela: string;
    bytes: number;
    tamanhoFmt: string;
    linhasAprox: number;
  }>;
  medidoEm: string;
}

function DbHealthSection() {
  const { data, loading, error, refetch } = useApiQuery<DbHealthResponse>('/admin/db-health');
  const totalBytes = data?.totalBytes ?? 0;
  // Alertas visuais por faixa de tamanho (limites de plano Railway Hobby ~1GB)
  const alerta =
    totalBytes > 5 * 1024 * 1024 * 1024
      ? { texto: 'Banco grande — considere cleanup', cor: BRAND.danger }
      : totalBytes > 1 * 1024 * 1024 * 1024
        ? { texto: 'Atenção ao crescimento', cor: 'var(--warning)' }
        : null;

  return (
    <section className="bg-surface border border-border rounded-[10px] p-6 mb-4">
      <div className="flex items-center gap-3 mb-2">
        <h2 className="m-0 text-[16px]">💾 Saúde do banco</h2>
        {data && (
          <span className="text-[11px] text-muted font-mono">
            atualizado em {new Date(data.medidoEm).toLocaleString('pt-BR')}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={refetch}
          disabled={loading}
          data-testid="db-health-refresh"
          className="text-[12px] py-1 px-2.5 bg-transparent text-muted border border-border rounded-md cursor-pointer"
        >
          {loading ? 'atualizando…' : 'Atualizar'}
        </button>
      </div>
      <p className="text-[12px] text-muted m-0 mb-3">
        Visibilidade de quanto cada tabela ocupa no Postgres. Use pra detectar
        crescimento descontrolado antes do disco encher de novo.
      </p>
      <StateView loading={loading && !data} error={error} onRetry={refetch}>
        {data && (
          <>
            <div
              className="flex items-center gap-4 py-3 px-4 rounded-md mb-3 border"
              style={{
                background: alerta ? `${alerta.cor}15` : 'var(--bg-alt)',
                borderColor: alerta ? alerta.cor : 'var(--border)',
              }}
            >
              <div>
                <div className="text-[10px] text-muted uppercase tracking-[0.3px] font-semibold">
                  Tamanho total do banco
                </div>
                <div
                  className="text-[22px] font-bold font-mono"
                  style={{ color: alerta?.cor ?? 'var(--text)' }}
                  data-testid="db-health-total"
                >
                  {data.totalFmt}
                </div>
              </div>
              {alerta && (
                <div className="text-[12px] font-semibold" style={{ color: alerta.cor }}>
                  ⚠️ {alerta.texto}
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-[0.4rem] px-2 font-semibold text-muted">Tabela</th>
                    <th className="py-[0.4rem] px-2 font-semibold text-muted text-right">Tamanho</th>
                    <th className="py-[0.4rem] px-2 font-semibold text-muted text-right">
                      Linhas (aprox.)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.tabelas.slice(0, 20).map((t) => {
                    const pct = totalBytes > 0 ? (t.bytes / totalBytes) * 100 : 0;
                    return (
                      <tr key={t.tabela} className="border-b border-border">
                        <td className="py-[0.4rem] px-2 font-mono">{t.tabela}</td>
                        <td className="py-[0.4rem] px-2 text-right font-mono">
                          {t.tamanhoFmt}
                          <span className="text-[10px] text-muted ml-[0.4rem]">
                            ({formatPercent(pct, 1)})
                          </span>
                        </td>
                        <td className="py-[0.4rem] px-2 text-right text-muted font-mono">
                          {formatNumero(t.linhasAprox)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </StateView>
    </section>
  );
}

// ─── Backup do banco ──────────────────────────────────────────────────

interface BackupUltimo {
  path: string;
  bytes: number;
  criadoEm: string;
}

interface BackupExecutarResp {
  ok: boolean;
  result?: { path: string; bytes: number; durationMs: number };
  erro?: string;
}

interface BackupVerificarResp {
  ok: boolean;
  path: string;
  modo: 'list' | 'restore';
  objetos?: number;
  erro?: string;
}

/** Formata bytes: <1MB em KB, senão MB com 2 casas. */
function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

/**
 * Backup do banco inteiro — ADMIN-only (operação global, não filtra por empresa).
 * A AdminPage já é restrita a `admin.panel`, mas como o backup cobre o banco
 * todo, gateamos explicitamente em ADMIN aqui também.
 */
function BackupSection() {
  const role = useRole();
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<BackupUltimo | null>('/backup/ultimo');
  const [running, setRunning] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Backup é do banco inteiro → só ADMIN vê este card.
  if (role !== 'ADMIN') return null;

  async function runBackup() {
    setRunning(true);
    try {
      // pg_dump pode passar dos 10s default conforme o banco cresce.
      const res = await api.post<BackupExecutarResp>('/backup/executar', undefined, {
        timeoutMs: 120_000,
      });
      if (res.ok && res.result) {
        toast.success(
          'Backup concluído',
          `${fmtBytes(res.result.bytes)} em ${Math.round(res.result.durationMs / 1000)}s`,
        );
        refetch();
      } else {
        toast.error('Falha no backup', res.erro);
      }
    } catch (err) {
      toast.error('Falha no backup', err instanceof ApiError ? err.message : undefined);
    } finally {
      setRunning(false);
    }
  }

  async function verifyBackup() {
    setVerifying(true);
    try {
      // pg_restore --list baixa e lê o dump inteiro — pode passar dos 10s default.
      const res = await api.post<BackupVerificarResp>('/backup/verificar', undefined, {
        timeoutMs: 120_000,
      });
      if (res.ok) {
        toast.success('Backup íntegro', `${res.objetos ?? 0} objetos no dump`);
      } else {
        toast.error('Backup com problema', res.erro);
      }
    } catch (err) {
      toast.error('Backup com problema', err instanceof ApiError ? err.message : undefined);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <section className="bg-surface border border-border rounded-[10px] p-6 mb-4" data-testid="backup-card">
      <h2 className="mt-0 text-[16px]">🗄️ Backup do banco</h2>
      <p className="text-[12px] text-muted m-0 mb-3 leading-[1.5]">
        O backup automático roda todo dia. Use os botões abaixo pra rodar um backup na hora
        ou checar a integridade do último dump.
      </p>

      <StateView loading={loading && !data} error={error} onRetry={refetch}>
        <div className="py-3 px-4 bg-bg-alt border border-border rounded-md mb-3">
          <div className="text-[10px] text-muted uppercase tracking-[0.3px] font-semibold">
            Último backup
          </div>
          <div className="text-[14px] font-semibold text-text mt-0.5">
            {data
              ? `${new Date(data.criadoEm).toLocaleString('pt-BR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })} (${fmtBytes(data.bytes)})`
              : 'Nenhum backup ainda'}
          </div>
        </div>
      </StateView>

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          data-testid="backup-run"
          onClick={runBackup}
          disabled={running}
          className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold tracking-[-0.1px]"
          style={{ opacity: running ? 0.6 : 1, cursor: running ? 'wait' : 'pointer' }}
        >
          {running ? 'Rodando backup…' : 'Rodar backup agora'}
        </button>
        <button
          type="button"
          data-testid="backup-verify"
          onClick={verifyBackup}
          disabled={verifying}
          className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium tracking-[-0.1px]"
          style={{ opacity: verifying ? 0.6 : 1, cursor: verifying ? 'wait' : 'pointer' }}
        >
          {verifying ? 'Verificando…' : 'Verificar integridade'}
        </button>
      </div>
    </section>
  );
}

// ─── Audit log viewer ────────────────────────────────────────────────

interface AuditLogEntry {
  id: string;
  usuarioId: string | null;
  empresaId: string | null;
  acao: string;
  recurso: string;
  recursoId: string | null;
  ip: string | null;
  criadoEm: string;
  detalhes: Record<string, unknown> | null;
}

interface AuditListResponse {
  data: AuditLogEntry[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function AuditLogSection() {
  const [filters, setFilters] = useState({ acao: '', recurso: '', usuarioId: '' });
  const [page, setPage] = useState(1);
  const limit = 20;

  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.acao) params.set('acao', filters.acao);
  if (filters.recurso) params.set('recurso', filters.recurso);
  if (filters.usuarioId) params.set('usuarioId', filters.usuarioId);

  const { data, loading, error, refetch } = useApiQuery<AuditListResponse>(
    `/audit?${params.toString()}`,
  );
  const recursosQuery = useApiQuery<string[]>('/audit/recursos');

  const entries = data?.data ?? [];
  const totalPages = data?.pagination?.totalPages ?? 1;
  const total = data?.pagination?.total ?? 0;

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'when',
      header: 'Quando',
      render: (e) => (
        <span className="text-[11px] text-muted whitespace-nowrap">{fmtDate(e.criadoEm)}</span>
      ),
    },
    {
      key: 'who',
      header: 'Usuário',
      render: (e) => (
        <span className={cn('text-[11px] font-mono', e.usuarioId ? 'text-text' : 'text-muted')}>
          {e.usuarioId ?? '(system)'}
        </span>
      ),
    },
    {
      key: 'acao',
      header: 'Ação',
      render: (e) => (
        <span className="inline-flex items-center rounded-full px-[9px] py-0.5 font-semibold leading-[1.6] tracking-[0.2px] bg-[#2bcae5]/12 text-[#2bcae5] border border-[#2bcae5]/19 font-mono text-[10px]">
          {e.acao}
        </span>
      ),
    },
    {
      key: 'recurso',
      header: 'Recurso',
      render: (e) => (
        <div className="text-[12px]">
          <strong className="text-text">{e.recurso}</strong>
          {e.recursoId && (
            <div className="text-[10px] text-muted font-mono mt-0.5">
              {e.recursoId.length > 24 ? `${e.recursoId.slice(0, 24)}…` : e.recursoId}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'ip',
      header: 'IP',
      render: (e) => (
        <span className="text-[11px] text-muted font-mono">{e.ip ?? '—'}</span>
      ),
    },
  ];

  return (
    <section className="bg-surface border border-border rounded-[10px] p-6 mb-4">
      <header className="flex justify-between items-start gap-3 flex-wrap mb-3">
        <div>
          <h2 className="m-0 text-[16px] text-text">📋 Audit log</h2>
          <p className="text-[12px] text-muted mt-1 mr-0 mb-0 ml-0">
            Quem fez o quê, quando. Cobertura: todas as ações com `@Audit` decorator.
            {total > 0 && ` ${total} registros no total.`}
          </p>
        </div>
        <button
          type="button"
          data-testid="audit-refresh"
          onClick={() => {
            refetch();
            recursosQuery.refetch();
          }}
          className="bg-surface text-text border border-border-strong rounded-md py-1.5 px-3.5 text-[12px] font-medium cursor-pointer tracking-[-0.1px]"
        >
          Atualizar
        </button>
      </header>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap mb-3">
        <input
          type="text"
          placeholder="Filtrar por ação (ex: update)"
          value={filters.acao}
          data-testid="audit-filter-acao"
          onChange={(e) => {
            setPage(1);
            setFilters((f) => ({ ...f, acao: e.target.value }));
          }}
          className="py-1.5 px-2.5 text-[12px] border border-border rounded-[10px] flex-[1_1_160px] min-w-[140px] bg-surface"
        />
        <select
          value={filters.recurso}
          data-testid="audit-filter-recurso"
          onChange={(e) => {
            setPage(1);
            setFilters((f) => ({ ...f, recurso: e.target.value }));
          }}
          className="py-1.5 px-2.5 text-[12px] border border-border rounded-[10px] flex-[0_0_auto] bg-surface"
        >
          <option value="">Todos os recursos</option>
          {(recursosQuery.data ?? []).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Usuário (id)"
          value={filters.usuarioId}
          data-testid="audit-filter-user"
          onChange={(e) => {
            setPage(1);
            setFilters((f) => ({ ...f, usuarioId: e.target.value }));
          }}
          className="py-1.5 px-2.5 text-[12px] border border-border rounded-[10px] flex-[1_1_140px] min-w-[120px] bg-surface font-mono"
        />
      </div>

      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && entries.length === 0}
        emptyMessage="Nenhum evento encontrado com esses filtros."
        onRetry={refetch}
      >
        <Table data={entries} columns={columns} rowKey={(e) => e.id} />
        {totalPages > 1 && (
          <div className="flex justify-between items-center mt-3 text-[12px]">
            <span className="text-muted">
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="bg-surface text-text border border-border-strong rounded-md py-1 px-2.5 text-[12px] font-medium tracking-[-0.1px]"
                style={{
                  opacity: page <= 1 ? 0.5 : 1,
                  cursor: page <= 1 ? 'not-allowed' : 'pointer',
                }}
              >
                ← Anterior
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="bg-surface text-text border border-border-strong rounded-md py-1 px-2.5 text-[12px] font-medium tracking-[-0.1px]"
                style={{
                  opacity: page >= totalPages ? 0.5 : 1,
                  cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                }}
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </StateView>
    </section>
  );
}

// ─── Permissões granulares (link pra sub-página) ───────────────────────

function PermissoesGranularesSection() {
  return (
    <section className="bg-surface border border-border rounded-[10px] p-6 mb-4">
      <h2 className="mt-0 text-[16px]">🔐 Permissões granulares</h2>
      <p className="text-muted mt-0 text-[13px] leading-[1.5]">
        Configure quais módulos cada papel (DIRECTOR, GERENTE, SAC, REP) pode <strong>ver</strong>
        {' '}e <strong>editar</strong>. ADMIN sempre tem acesso total.
      </p>
      <Link
        to="/permissoes"
        data-testid="admin-open-permissoes"
        className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px] no-underline inline-block mt-2"
      >
        Abrir matriz de permissões →
      </Link>
    </section>
  );
}

// ─── Quick links ──────────────────────────────────────────────────────

function QuickLinksSection() {
  const links: Array<{ to: string; emoji: string; title: string; description: string }> = [
    {
      to: '/usuarios',
      emoji: '👥',
      title: 'Usuários',
      description: 'Convidar, editar papel, definir teto de desconto e comissão',
    },
    {
      to: '/configuracoes',
      emoji: '🏢',
      title: 'Empresas',
      description: 'CRUD de empresas, ativar/desativar',
    },
    {
      to: '/integracoes',
      emoji: '🔌',
      title: 'Integrações',
      description: 'OMIE, Meta, Mercado Livre, Shopee, Amazon, TikTok, WhatsApp',
    },
    {
      to: '/tags',
      emoji: '🏷️',
      title: 'Tags',
      description: 'Cadastro e gestão de tags de clientes',
    },
    {
      to: '/fluxos',
      emoji: '⚡',
      title: 'Fluxos automação',
      description: 'Triggers + ações via BullMQ',
    },
  ];

  return (
    <section className="bg-surface border border-border rounded-[10px] p-6">
      <h2 className="mt-0 text-[16px]">🧭 Atalhos administrativos</h2>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        }}
      >
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="p-3.5 bg-bg-alt border border-border rounded-md no-underline text-text block"
          >
            <div className="text-[20px] mb-1">{l.emoji}</div>
            <div className="font-semibold text-[14px]">{l.title}</div>
            <div className="text-[12px] text-muted mt-0.5 leading-[1.4]">{l.description}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
