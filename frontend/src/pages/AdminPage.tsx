import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { SistemaTabs } from '@/components/SistemaTabs';
import { StateView } from '@/components/StateView';
import { Table, type Column } from '@/components/Table';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/hooks/useConfirm';
import { badge, btn, btnSecondary, card, colors } from '@/components/styles';

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
      <p style={{ color: colors.muted, marginTop: 0, fontSize: 14 }}>
        Ferramentas operacionais e atalhos restritos ao papel ADMIN.
      </p>

      <SystemStatus />
      <DbHealthSection />
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
    <section style={{ ...card, marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>📡 Status do sistema</h2>
      <StateView
        loading={version.loading || health.loading}
        error={version.error ?? health.error}
        onRetry={() => {
          version.refetch();
          health.refetch();
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <Stat
            label="API status"
            value={health.data?.status === 'ok' ? 'Online' : 'Degraded'}
            color={health.data?.status === 'ok' ? colors.success : colors.danger}
          />
          <Stat label="Uptime" value={health.data?.uptime ? fmtUptime(health.data.uptime) : '—'} />
          <Stat label="Versão" value={version.data?.version ?? '—'} />
          <Stat label="Ambiente" value={version.data?.nodeEnv ?? '—'} />
          <Stat label="Service type" value={version.data?.serviceType ?? '—'} />
          <Stat label="Railway env" value={version.data?.railwayEnv || '—'} />
        </div>
        {version.data?.buildTimestamp && (
          <p style={{ fontSize: 11, color: colors.muted, marginTop: '0.5rem' }}>
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
      <div
        style={{
          fontSize: 10,
          color: colors.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color, marginTop: 2, wordBreak: 'break-word' }}>
        {value}
      </div>
    </div>
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
          <div style={{ fontWeight: 600, fontSize: 13 }}>{j.jobName ?? '—'}</div>
          <div style={{ fontSize: 11, color: colors.muted }}>
            <span style={badge(colors.info)}>{j.queue}</span> · {j.attemptsMade} tentativas
          </div>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Motivo da falha',
      render: (j) => (
        <div
          style={{
            fontSize: 12,
            color: colors.danger,
            maxWidth: 380,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
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
          style={{ ...btn, padding: '0.25rem 0.625rem', fontSize: 12 }}
        >
          Reenviar
        </button>
      ),
    },
  ];

  return (
    <section style={{ ...card, marginBottom: '1rem' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>💀 Dead-letter queue</h2>
        <button
          type="button"
          data-testid="dlq-refresh"
          onClick={refetch}
          style={{ ...btnSecondary, padding: '0.375rem 0.875rem', fontSize: 12 }}
        >
          Atualizar
        </button>
      </header>
      <p style={{ fontSize: 12, color: colors.muted, marginTop: 0, marginBottom: '0.75rem' }}>
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
        ? { texto: 'Atenção ao crescimento', cor: colors.warning }
        : null;

  return (
    <section style={{ ...card, marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>💾 Saúde do banco</h2>
        {data && (
          <span
            style={{
              fontSize: 11,
              color: colors.muted,
              fontFamily: 'var(--font-mono)',
            }}
          >
            atualizado em {new Date(data.medidoEm).toLocaleString('pt-BR')}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={refetch}
          disabled={loading}
          data-testid="db-health-refresh"
          style={{
            fontSize: 12,
            padding: '0.25rem 0.625rem',
            background: 'transparent',
            color: colors.muted,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {loading ? 'atualizando…' : 'Atualizar'}
        </button>
      </div>
      <p style={{ fontSize: 12, color: colors.muted, margin: '0 0 0.75rem 0' }}>
        Visibilidade de quanto cada tabela ocupa no Postgres. Use pra detectar
        crescimento descontrolado antes do disco encher de novo.
      </p>
      <StateView loading={loading && !data} error={error} onRetry={refetch}>
        {data && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '0.75rem 1rem',
                background: alerta ? `${alerta.cor}15` : '#fafbfc',
                border: `1px solid ${alerta ? alerta.cor : colors.border}`,
                borderRadius: 6,
                marginBottom: '0.75rem',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: colors.muted,
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                    fontWeight: 600,
                  }}
                >
                  Tamanho total do banco
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: alerta?.cor ?? colors.text,
                    fontFamily: 'var(--font-mono)',
                  }}
                  data-testid="db-health-total"
                >
                  {data.totalFmt}
                </div>
              </div>
              {alerta && (
                <div
                  style={{
                    fontSize: 12,
                    color: alerta.cor,
                    fontWeight: 600,
                  }}
                >
                  ⚠️ {alerta.texto}
                </div>
              )}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}`, textAlign: 'left' }}>
                    <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600, color: colors.muted }}>
                      Tabela
                    </th>
                    <th
                      style={{
                        padding: '0.4rem 0.5rem',
                        fontWeight: 600,
                        color: colors.muted,
                        textAlign: 'right',
                      }}
                    >
                      Tamanho
                    </th>
                    <th
                      style={{
                        padding: '0.4rem 0.5rem',
                        fontWeight: 600,
                        color: colors.muted,
                        textAlign: 'right',
                      }}
                    >
                      Linhas (aprox.)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.tabelas.slice(0, 20).map((t) => {
                    const pct = totalBytes > 0 ? (t.bytes / totalBytes) * 100 : 0;
                    return (
                      <tr key={t.tabela} style={{ borderBottom: `1px solid ${colors.border}` }}>
                        <td
                          style={{
                            padding: '0.4rem 0.5rem',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {t.tabela}
                        </td>
                        <td
                          style={{
                            padding: '0.4rem 0.5rem',
                            textAlign: 'right',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {t.tamanhoFmt}
                          <span
                            style={{
                              fontSize: 10,
                              color: colors.muted,
                              marginLeft: '0.4rem',
                            }}
                          >
                            ({pct.toFixed(1)}%)
                          </span>
                        </td>
                        <td
                          style={{
                            padding: '0.4rem 0.5rem',
                            textAlign: 'right',
                            color: colors.muted,
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {t.linhasAprox.toLocaleString('pt-BR')}
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
        <span style={{ fontSize: 11, color: colors.muted, whiteSpace: 'nowrap' }}>
          {fmtDate(e.criadoEm)}
        </span>
      ),
    },
    {
      key: 'who',
      header: 'Usuário',
      render: (e) => (
        <span
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: e.usuarioId ? colors.text : colors.muted,
          }}
        >
          {e.usuarioId ?? '(system)'}
        </span>
      ),
    },
    {
      key: 'acao',
      header: 'Ação',
      render: (e) => (
        <span
          style={{
            ...badge(BRAND.cyan),
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
          }}
        >
          {e.acao}
        </span>
      ),
    },
    {
      key: 'recurso',
      header: 'Recurso',
      render: (e) => (
        <div style={{ fontSize: 12 }}>
          <strong style={{ color: BRAND.navy }}>{e.recurso}</strong>
          {e.recursoId && (
            <div
              style={{
                fontSize: 10,
                color: colors.muted,
                fontFamily: 'var(--font-mono)',
                marginTop: 2,
              }}
            >
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
        <span style={{ fontSize: 11, color: colors.muted, fontFamily: 'var(--font-mono)' }}>
          {e.ip ?? '—'}
        </span>
      ),
    },
  ];

  return (
    <section style={{ ...card, marginBottom: '1rem' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginBottom: '0.75rem',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 16, color: BRAND.navy }}>📋 Audit log</h2>
          <p style={{ fontSize: 12, color: colors.muted, margin: '0.25rem 0 0' }}>
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
          style={{ ...btnSecondary, padding: '0.375rem 0.875rem', fontSize: 12 }}
        >
          Atualizar
        </button>
      </header>

      {/* Filtros */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginBottom: '0.75rem',
        }}
      >
        <input
          type="text"
          placeholder="Filtrar por ação (ex: update)"
          value={filters.acao}
          data-testid="audit-filter-acao"
          onChange={(e) => {
            setPage(1);
            setFilters((f) => ({ ...f, acao: e.target.value }));
          }}
          style={{
            padding: '0.375rem 0.625rem',
            fontSize: 12,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            flex: '1 1 160px',
            minWidth: 140,
            background: colors.surface,
          }}
        />
        <select
          value={filters.recurso}
          data-testid="audit-filter-recurso"
          onChange={(e) => {
            setPage(1);
            setFilters((f) => ({ ...f, recurso: e.target.value }));
          }}
          style={{
            padding: '0.375rem 0.625rem',
            fontSize: 12,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            flex: '0 0 auto',
            background: colors.surface,
          }}
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
          style={{
            padding: '0.375rem 0.625rem',
            fontSize: 12,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            flex: '1 1 140px',
            minWidth: 120,
            background: colors.surface,
            fontFamily: 'var(--font-mono)',
          }}
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '0.75rem',
              fontSize: 12,
            }}
          >
            <span style={{ color: colors.muted }}>
              Página {page} de {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '0.375rem' }}>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{
                  ...btnSecondary,
                  padding: '0.25rem 0.625rem',
                  fontSize: 12,
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
                style={{
                  ...btnSecondary,
                  padding: '0.25rem 0.625rem',
                  fontSize: 12,
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
    <section style={{ ...card, marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>🔐 Permissões granulares</h2>
      <p style={{ color: colors.muted, marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
        Configure quais módulos cada papel (DIRECTOR, GERENTE, SAC, REP) pode <strong>ver</strong>
        {' '}e <strong>editar</strong>. ADMIN sempre tem acesso total.
      </p>
      <Link
        to="/permissoes"
        data-testid="admin-open-permissoes"
        style={{
          ...btn,
          textDecoration: 'none',
          display: 'inline-block',
          marginTop: '0.5rem',
        }}
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
    <section style={card}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>🧭 Atalhos administrativos</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '0.75rem',
        }}
      >
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            style={{
              padding: '0.875rem',
              background: '#fafbfc',
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              textDecoration: 'none',
              color: colors.text,
              display: 'block',
            }}
          >
            <div style={{ fontSize: 20, marginBottom: 4 }}>{l.emoji}</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{l.title}</div>
            <div style={{ fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 1.4 }}>
              {l.description}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
