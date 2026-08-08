/**
 * AprovacoesPage — quem pode DECIDIR uma aprovação de desconto (auditoria lote 6).
 *
 * O bug: Aprovar/Rejeitar apareciam pro REP, que só tem `view` na matriz — a
 * decisão morria em 403 depois do clique. O gate agora é `aprovacoes.approve`,
 * espelhando o backend (ADMIN/DIRECTOR/GERENTE).
 */

import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const APROVACAO = {
  id: 'apr-1',
  status: 'PENDENTE',
  descontoSolicitado: 18.5,
  motivo: 'Cliente âncora, fecha volume',
  criadoEm: '2026-08-01T12:00:00.000Z',
  resolvidoEm: null,
  comentarioAprovador: null,
  representante: { id: 'rep-1', nome: 'João' },
  gerente: null,
  pedido: { id: 'ped-1', numero: 'PED-2026-001', total: 15000 },
};

const LISTA = { data: [APROVACAO], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } };

/** Permissões concedidas neste teste (o hook consulta este set). */
let permissoes = new Set<string>(['aprovacoes.approve', 'aprovacoes.decide']);

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (p: string) => permissoes.has(p),
  useRole: () => 'DIRECTOR',
  hasPermission: (p: string) => permissoes.has(p),
}));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    if (path === null) return { data: null, loading: false, error: null, refetch: vi.fn() };
    if (path.startsWith('/aprovacoes/'))
      return { data: APROVACAO, loading: false, error: null, refetch: vi.fn() };
    if (path.startsWith('/aprovacoes'))
      return { data: LISTA, loading: false, error: null, refetch: vi.fn() };
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  },
}));

vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const postMock = vi.fn(() => Promise.resolve({}));
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({})),
    post: (...a: unknown[]) => postMock(...(a as [])),
    put: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  ApiError: class extends Error {},
  apiErrorMessage: (e: unknown) => String(e),
}));

vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {actions && <div data-testid="page-actions">{actions}</div>}
      {children}
    </div>
  ),
  useIsMobile: () => false,
}));

vi.mock('@/components/VendasTabs', () => ({ VendasTabs: () => <nav /> }));

const { default: AprovacoesPage } = await import('./AprovacoesPage');

afterEach(cleanup);
beforeEach(() => {
  postMock.mockClear();
  permissoes = new Set(['aprovacoes.approve', 'aprovacoes.decide']);
});

/** Abre o detalhe da 1ª aprovação da lista. */
function abrirDetalhe() {
  const alvo =
    screen.queryByText('PED-2026-001') ?? screen.getAllByText(/PED-2026-001/)[0];
  fireEvent.click(alvo);
}

describe('AprovacoesPage — gate de decisão', () => {
  it('quem TEM aprovacoes.approve vê Aprovar e Rejeitar', async () => {
    render(<AprovacoesPage />);
    abrirDetalhe();

    await waitFor(() => expect(screen.queryByTestId('aprov-aprovar')).not.toBeNull());
    expect(screen.queryByTestId('aprov-rejeitar')).not.toBeNull();
  });

  it('REP (só view) NÃO vê os botões — a decisão morria em 403', async () => {
    permissoes = new Set(); // sem approve
    render(<AprovacoesPage />);
    abrirDetalhe();

    // O detalhe abre (ele PODE ver a solicitação), mas sem ação de decisão.
    await waitFor(() => expect(screen.queryByText(/Cliente âncora/)).not.toBeNull());
    expect(screen.queryByTestId('aprov-aprovar')).toBeNull();
    expect(screen.queryByTestId('aprov-rejeitar')).toBeNull();
  });
});
