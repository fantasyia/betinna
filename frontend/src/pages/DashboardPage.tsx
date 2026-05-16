import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { usePermission, useRole } from '@/hooks/usePermission';

interface ResumoVendas {
  faturamento: { atual: number };
  totalPedidos: number;
}

/**
 * DashboardPage — exemplo de página com 3 estados (loading / error / empty)
 * + RBAC condicional na navegação. Sprint 4 FIX 6.
 */
export default function DashboardPage() {
  const role = useRole();
  const canSeeFidelidade = usePermission('fidelidade.view');
  const canSeeMullerBotConfig = usePermission('mullerbot.config');
  const canSeeAdmin = usePermission('admin.panel');
  const canBulkAssign = usePermission('clientes.bulkAssign');

  const [data, setData] = useState<ResumoVendas | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const r = await api.get<ResumoVendas>('/relatorios/vendas?periodo=mes');
        if (!cancelled) setData(r);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Erro ao carregar');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function retry() {
    setError(null);
    setLoading(true);
    setData(null);
    // Trigger reload — simples
    window.location.reload();
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 data-testid="dashboard-title">Dashboard</h1>
        <p style={{ color: '#666' }}>
          Logado como <strong>{role}</strong>
        </p>
      </header>

      <nav style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        <Link to="/clientes">Clientes</Link>
        <Link to="/pedidos">Pedidos</Link>
        <Link to="/comissoes">Comissões</Link>
        <Link to="/whatsapp">WhatsApp</Link>

        {/* Sprint 4 FIX 6 — RBAC condicional */}
        {canSeeFidelidade && (
          <Link to="/fidelidade" data-testid="fidelidade-nav">
            Fidelidade
          </Link>
        )}
        {canSeeMullerBotConfig && (
          <Link to="/mullerbot/config" data-testid="mullerbot-config-nav">
            MullerBot Config
          </Link>
        )}
        {canSeeAdmin && (
          <Link to="/admin" data-testid="admin-nav">
            Admin
          </Link>
        )}
        {canBulkAssign && (
          <button data-testid="bulk-assign-btn" type="button">
            Atribuir Rep em Massa
          </button>
        )}
      </nav>

      {/* Sprint 4 FIX 6 — 3 estados: loading, error, empty */}
      <section style={{ background: '#fff', padding: '1.5rem', borderRadius: 8 }}>
        <h2>Faturamento do mês</h2>
        {loading && (
          <div data-testid="loading-skeleton">
            <div
              style={{
                width: '180px',
                height: '32px',
                background: '#eee',
                borderRadius: 4,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          </div>
        )}
        {!loading && error && (
          <div data-testid="error-state">
            <p style={{ color: '#dc2626' }}>{error}</p>
            <button onClick={retry} type="button" data-testid="retry-btn">
              Tentar novamente
            </button>
          </div>
        )}
        {!loading && !error && data && data.totalPedidos === 0 && (
          <div data-testid="empty-state">
            <p style={{ color: '#666' }}>
              Sem vendas registradas neste mês. Comece criando um pedido.
            </p>
          </div>
        )}
        {!loading && !error && data && data.totalPedidos > 0 && (
          <div data-testid="dashboard-data">
            <p style={{ fontSize: '2rem', fontWeight: 600 }}>
              R$ {data.faturamento.atual.toFixed(2)}
            </p>
            <p style={{ color: '#666' }}>{data.totalPedidos} pedidos</p>
          </div>
        )}
      </section>
    </div>
  );
}
