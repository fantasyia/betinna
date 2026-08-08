/**
 * ClienteDetailPage — gates de PAPEL nas ações que mexem em dinheiro/bloqueio
 * (auditoria lotes 1 e 6).
 *
 * O que estes testes travam:
 *  1. "Excluir cliente" só pra ADMIN/DIRECTOR/GERENTE (backend recusa o resto)
 *  2. Status OMIE (ATIVO/BLOQUEADO) travado pro REP — o bloqueio vem do
 *     financeiro (D2); o rep não se desbloqueia pra fechar pedido
 *  3. Preço negociado: criar/remover é ADMIN/DIRECTOR — o rep podia gravar
 *     preço arbitrário e faturar sem passar por aprovação
 */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const CLIENTE = {
  id: 'cli-1',
  nome: 'Padaria do João',
  cnpj: '12.345.678/0001-90',
  email: 'j@x.com',
  telefone: '11999990000',
  cidade: 'São Paulo',
  uf: 'SP',
  segmento: 'Padaria',
  status: 'ATIVO',
  omieStatus: 'ATIVO',
  score: 70,
  prazoPagamento: 30,
  limiteCredito: null,
  representante: { id: 'rep-1', nome: 'João' },
  tags: [],
  criadoEm: '2026-01-01T00:00:00.000Z',
};

const PRECOS = [
  {
    produtoId: 'prod-1',
    precoEspecial: 9.9,
    descontoBase: 10,
    validoAte: null,
    produto: { id: 'prod-1', nome: 'Farinha', sku: 'FAR-1', precoTabela: 11 },
  },
];

let papel = 'DIRECTOR';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'cli-1' }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
  useRole: () => papel,
  hasPermission: () => true,
}));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    if (path?.includes('precos-especiais'))
      return { data: PRECOS, loading: false, error: null, refetch: vi.fn() };
    if (path?.includes('/clientes/cli-1'))
      return { data: CLIENTE, loading: false, error: null, refetch: vi.fn() };
    return { data: [], loading: false, error: null, refetch: vi.fn() };
  },
}));

vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

// useConfirm devolve TUPLA [confirmAsync, ConfirmDialog] — não objeto.
vi.mock('@/hooks/useConfirm', () => ({
  useConfirm: () => [() => Promise.resolve(true), null],
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
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

vi.mock('@/components/NovoPedidoDialog', () => ({ NovoPedidoDialog: () => null }));
vi.mock('@/components/AsyncCombobox', () => ({ AsyncCombobox: () => null }));

const { default: ClienteDetailPage } = await import('./ClienteDetailPage');

afterEach(cleanup);
beforeEach(() => {
  papel = 'DIRECTOR';
});

/** Vai pra aba de preços negociados. */
function abrirAbaPrecos() {
  fireEvent.click(screen.getByText(/Preços/i));
}

describe('ClienteDetailPage — excluir cliente', () => {
  it('DIRECTOR vê o botão de excluir', () => {
    papel = 'DIRECTOR';
    render(<ClienteDetailPage />);
    expect(screen.queryByTestId('cliente-del')).not.toBeNull();
  });

  it('GERENTE vê o botão de excluir', () => {
    papel = 'GERENTE';
    render(<ClienteDetailPage />);
    expect(screen.queryByTestId('cliente-del')).not.toBeNull();
  });

  it('REP NÃO vê (o backend recusa com 403)', () => {
    papel = 'REP';
    render(<ClienteDetailPage />);
    expect(screen.queryByTestId('cliente-del')).toBeNull();
  });

  it('SAC NÃO vê', () => {
    papel = 'SAC';
    render(<ClienteDetailPage />);
    expect(screen.queryByTestId('cliente-del')).toBeNull();
  });
});

describe('ClienteDetailPage — status OMIE', () => {
  function selectOmie(): HTMLSelectElement | null {
    // O select de OMIE é o que tem exatamente as opções Ativo/Bloqueado.
    const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
    return (
      selects.find(
        (s) =>
          s.options.length === 2 &&
          Array.from(s.options).some((o) => o.value === 'BLOQUEADO'),
      ) ?? null
    );
  }

  it('REP não consegue mexer (bloqueio vem do financeiro — D2)', () => {
    papel = 'REP';
    render(<ClienteDetailPage />);
    expect(selectOmie()?.disabled).toBe(true);
  });

  it('GERENTE consegue mexer', () => {
    papel = 'GERENTE';
    render(<ClienteDetailPage />);
    expect(selectOmie()?.disabled).toBe(false);
  });
});

describe('ClienteDetailPage — preço negociado', () => {
  it('DIRECTOR pode adicionar e remover', () => {
    papel = 'DIRECTOR';
    render(<ClienteDetailPage />);
    abrirAbaPrecos();
    expect(screen.queryByTestId('preco-add')).not.toBeNull();
    expect(screen.queryByTestId('preco-del-prod-1')).not.toBeNull();
  });

  it('REP NÃO pode (gravava preço arbitrário e faturava sem aprovação)', () => {
    papel = 'REP';
    render(<ClienteDetailPage />);
    abrirAbaPrecos();
    expect(screen.queryByTestId('preco-add')).toBeNull();
    expect(screen.queryByTestId('preco-del-prod-1')).toBeNull();
  });

  it('GERENTE também NÃO pode (decisão de preço é DIRECTOR/ADMIN — D4/D46)', () => {
    papel = 'GERENTE';
    render(<ClienteDetailPage />);
    abrirAbaPrecos();
    expect(screen.queryByTestId('preco-add')).toBeNull();
  });
});
