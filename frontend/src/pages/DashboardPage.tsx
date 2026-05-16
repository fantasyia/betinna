import { Link } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole, usePermission } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { KPICard, Funnel, BarChart } from '@/components/charts';
import { btn, btnSecondary, card, colors } from '@/components/styles';

interface DashboardResp {
  vendas: {
    faturamento: { atual: number; anterior: number; variacao: number };
    totalPedidos: number;
    ticketMedio: number;
    porRep: Array<{ repId: string; repNome: string; pedidos: number; total: number }>;
  };
  funil: {
    funilAtual: Array<{ etapa: string; count: number; valorEstimado: number }>;
    totalAtivos: number;
    taxaConversao: number;
  };
  sac: {
    abertas: number;
    slaEstourado: number;
  };
  amostras: {
    enviadas: number;
    convertidas: number;
    taxaConversao: number;
  };
}

const ETAPA_LABEL: Record<string, string> = {
  NOVO: 'Novo',
  QUALIFICANDO: 'Qualificando',
  PROPOSTA: 'Proposta',
  NEGOCIACAO: 'Negociação',
  GANHO: 'Ganho',
  PERDIDO: 'Perdido',
};
const ETAPA_COLOR: Record<string, string> = {
  NOVO: '#0891b2',
  QUALIFICANDO: '#7c3aed',
  PROPOSTA: colors.warning,
  NEGOCIACAO: '#d97706',
  GANHO: colors.success,
  PERDIDO: colors.danger,
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtBRLCompact(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return fmtBRL(v);
}

export default function DashboardPage() {
  const role = useRole();
  const canSeeRelatorios = usePermission('relatorios.view');

  const { data, loading, error, refetch } = useApiQuery<DashboardResp>(
    canSeeRelatorios ? '/relatorios/dashboard?periodo=mes' : null,
  );

  return (
    <PageLayout
      title="Dashboard"
      actions={
        canSeeRelatorios ? (
          <Link to="/relatorios" style={{ ...btnSecondary, textDecoration: 'none' }}>
            Ver relatórios completos →
          </Link>
        ) : undefined
      }
    >
      <p style={{ marginTop: 0, color: colors.muted, fontSize: 14 }}>
        Bem-vindo! Você está logado como <strong>{role}</strong>.
      </p>

      {canSeeRelatorios ? (
        <StateView loading={loading} error={error} onRetry={refetch}>
          {data && (() => {
            // Defensive defaults — qualquer campo do response pode vir undefined
            // se o backend tiver dados zerados ou parciais.
            const vendas = data.vendas ?? ({} as DashboardResp['vendas']);
            const funil = data.funil ?? ({} as DashboardResp['funil']);
            const sac = data.sac ?? ({} as DashboardResp['sac']);
            const faturamento = vendas.faturamento ?? { atual: 0, anterior: 0, variacao: 0 };
            const porRep = vendas.porRep ?? [];
            const funilAtual = funil.funilAtual ?? [];
            const totalPedidos = vendas.totalPedidos ?? 0;
            const ticketMedio = vendas.ticketMedio ?? 0;
            const totalAtivos = funil.totalAtivos ?? 0;
            const taxaConversao = funil.taxaConversao ?? 0;
            const slaEstourado = sac.slaEstourado ?? 0;

            return (
              <>
                {/* KPI cards */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '0.75rem',
                    marginBottom: '1rem',
                  }}
                >
                  <KPICard
                    label="Faturamento (mês)"
                    value={fmtBRLCompact(faturamento.atual)}
                    variacao={faturamento.variacao}
                  />
                  <KPICard label="Pedidos" value={String(totalPedidos)} />
                  <KPICard label="Ticket médio" value={fmtBRL(ticketMedio)} />
                  <KPICard label="Leads ativos" value={String(totalAtivos)} />
                  <KPICard
                    label="Taxa conversão"
                    value={`${taxaConversao}%`}
                    color={
                      taxaConversao > 30
                        ? colors.success
                        : taxaConversao > 15
                        ? colors.warning
                        : colors.danger
                    }
                  />
                  <KPICard
                    label="SLA estourado (SAC)"
                    value={String(slaEstourado)}
                    color={slaEstourado > 0 ? colors.danger : colors.success}
                  />
                </div>

                {/* Charts */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1rem',
                    marginBottom: '1rem',
                  }}
                >
                  <div style={card}>
                    <h2 style={{ margin: '0 0 0.75rem', fontSize: 15 }}>
                      Top representantes (vendas)
                    </h2>
                    {porRep.length === 0 ? (
                      <p style={{ color: colors.muted, fontSize: 13 }}>
                        Nenhuma venda registrada no período. Comece criando um pedido.
                      </p>
                    ) : (
                      <BarChart
                        data={porRep.slice(0, 5).map((r) => ({
                          label: r.repNome,
                          sublabel: `${r.pedidos} pedido${r.pedidos === 1 ? '' : 's'}`,
                          value: r.total,
                        }))}
                        formatValue={fmtBRLCompact}
                      />
                    )}
                  </div>

                  <div style={card}>
                    <h2 style={{ margin: '0 0 0.75rem', fontSize: 15 }}>Funil de leads</h2>
                    {funilAtual.length === 0 || funilAtual.every((e) => e.count === 0) ? (
                      <p style={{ color: colors.muted, fontSize: 13 }}>
                        Sem leads ainda. Comece a captação em /leads.
                      </p>
                    ) : (
                      <Funnel
                        stages={funilAtual.map((e) => ({
                          label: ETAPA_LABEL[e.etapa] ?? e.etapa,
                          value: e.count,
                          color: ETAPA_COLOR[e.etapa],
                        }))}
                      />
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </StateView>
      ) : (
        <p style={{ color: colors.muted }}>
          Você não tem permissão pra ver relatórios. Use o menu acima pra navegar.
        </p>
      )}

      {/* Quick actions */}
      <div style={card}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Atalhos</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <QuickAction to="/clientes" label="Clientes" emoji="👥" />
          <QuickAction to="/pedidos" label="Pedidos" emoji="🛒" />
          <QuickAction to="/leads" label="Leads (Kanban)" emoji="📊" />
          <QuickAction to="/inbox" label="Inbox" emoji="💬" />
          <QuickAction to="/agenda" label="Agenda" emoji="📅" />
          <QuickAction to="/comissoes" label="Comissões" emoji="💰" />
          <QuickAction to="/catalogo" label="Meu catálogo" emoji="📦" />
          <QuickAction to="/integracoes" label="Integrações" emoji="🔌" />
        </div>
      </div>

      {/* Status do sistema */}
      {data && (data.vendas?.totalPedidos ?? 0) === 0 && (
        <div
          style={{
            ...card,
            marginTop: '1rem',
            background: '#fafbfc',
          }}
        >
          <h3 style={{ marginTop: 0, fontSize: 14 }}>👋 Primeiros passos</h3>
          <p style={{ fontSize: 13, color: colors.muted, marginBottom: '0.75rem' }}>
            Você está em uma instância nova. Pra começar a operar:
          </p>
          <ol style={{ fontSize: 13, color: colors.muted, paddingLeft: 20, lineHeight: 1.7 }}>
            <li>
              <Link to="/integracoes" style={{ color: colors.primary }}>
                Conectar OMIE
              </Link>{' '}
              → sync de clientes + produtos
            </li>
            <li>
              <Link to="/usuarios" style={{ color: colors.primary }}>
                Convidar usuários
              </Link>{' '}
              → adicionar reps e gerentes
            </li>
            <li>
              <Link to="/clientes" style={{ color: colors.primary }}>
                Cadastrar clientes
              </Link>{' '}
              ou importar via OMIE
            </li>
            <li>
              <Link to="/produtos" style={{ color: colors.primary }}>
                Catálogo de produtos
              </Link>{' '}
              ou importar via OMIE
            </li>
            <li>
              <Link to="/pedidos" style={{ color: colors.primary }}>
                Criar primeiro pedido
              </Link>
            </li>
          </ol>
        </div>
      )}
    </PageLayout>
  );
}

function QuickAction({
  to,
  label,
  emoji,
}: {
  to: string;
  label: string;
  emoji: string;
}) {
  return (
    <Link
      to={to}
      style={{
        ...btn,
        textDecoration: 'none',
        background: colors.surface,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.375rem',
        fontSize: 13,
      }}
    >
      <span>{emoji}</span>
      <span>{label}</span>
    </Link>
  );
}
