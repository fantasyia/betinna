/**
 * ProfilePage — o contrato dos diálogos que mexem em DINHEIRO.
 *
 * A regressão real (29/08): o diálogo de comissão mandava `comissaoPercentual`,
 * campo que a API nunca aceitou. A validação recusava e a tela só dizia
 * "Falha" — a % do rep simplesmente não tinha como ser alterada, e o
 * fechamento seguia pagando a % antiga.
 *
 * Nome de campo inventado no front é o tipo de erro que só aparece na mão do
 * usuário: o typecheck não vê, e o teste que mocka o mesmo chute passa.
 */
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const USUARIOS = {
  data: [
    {
      id: 'rep-1',
      nome: 'Rep Teste',
      email: 'rep@betinna.ai',
      role: 'REP',
      status: 'ATIVO',
      comissaoPadrao: 5,
      tetoDesconto: 10,
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

const put = vi.fn(() => Promise.resolve({}));

vi.mock('react-router-dom', () => ({
  // Com id na rota a página abre o DETALHE, que é onde vivem os diálogos.
  useParams: () => ({ id: 'rep-1' }),
  useLocation: () => ({ pathname: '/usuarios', search: '' }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
  useRole: () => 'ADMIN',
  hasPermission: () => true,
}));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => ({
    data: path && path.includes('/users/rep-1') ? USUARIOS.data[0] : USUARIOS,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/auth-store', () => ({
  getSession: () => ({ user: { id: 'admin-1' } }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    put: (...args: unknown[]) => put(...(args as [])),
    patch: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  ApiError: class extends Error {},
  apiErrorMessage: (e: unknown) => String(e),
}));

vi.mock('@/components/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useIsMobile: () => false,
}));

vi.mock('@/components/SistemaTabs', () => ({ SistemaTabs: () => <nav /> }));
vi.mock('@/components/OnboardingTour', () => ({ startOnboarding: vi.fn() }));

const { default: Pagina } = await import('./ProfilePage');

afterEach(() => {
  cleanup();
  put.mockClear();
});

describe('ProfilePage — diálogos de dinheiro', () => {
  it('salvar comissão manda as duas % (os nomes que a API aceita)', () => {
    render(<Pagina />);
    fireEvent.click(screen.getByTestId('user-comissao-btn'));
    fireEvent.change(screen.getByTestId('comissao-input'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByTestId('comissao-site-input'), {
      target: { value: '7.25' },
    });
    fireEvent.click(screen.getByTestId('comissao-save'));

    expect(put).toHaveBeenCalledWith('/users/rep-1/comissao', {
      comissaoPadrao: 10,
      comissaoSite: 7.25,
    });
  });

  it('salvar teto manda `tetoDesconto`', () => {
    render(<Pagina />);
    fireEvent.click(screen.getByTestId('user-teto-btn'));
    fireEvent.change(screen.getByTestId('teto-input'), {
      target: { value: '15' },
    });
    fireEvent.click(screen.getByTestId('teto-save'));

    expect(put).toHaveBeenCalledWith('/users/rep-1/teto-desconto', {
      tetoDesconto: 15,
    });
  });
});
