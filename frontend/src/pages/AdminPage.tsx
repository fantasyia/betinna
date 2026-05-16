import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Table, type Column } from '@/components/Table';
import { useToast } from '@/components/toast';
import { badge, btn, btnSecondary, card, colors } from '@/components/styles';

/**
 * Admin Panel — apenas ADMIN.
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
    <PageLayout title="Painel administrativo">
      <p style={{ color: colors.muted, marginTop: 0, fontSize: 14 }}>
        Ferramentas operacionais e atalhos restritos ao papel ADMIN.
      </p>

      <SystemStatus />
      <DeadLetterSection />
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

  async function retry(jobId: string) {
    if (!confirm('Reenviar este job pra queue original? Use com cuidado — se a causa raiz não foi corrigida, vai falhar de novo.')) return;
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
            <span style={badge('#0891b2')}>{j.queue}</span> · {j.attemptsMade} tentativas
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
      description: 'CRUD de empresas, plano, ativar/desativar',
    },
    {
      to: '/permissoes',
      emoji: '🔐',
      title: 'Permissões',
      description: 'Matriz Role × Módulo (ver / editar) por papel',
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
