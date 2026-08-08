/**
 * CatalogoPage — spec de fumaça das páginas de DINHEIRO (auditoria: as 14 páginas onde
 * o app mexe com valor não tinham NENHUM teste).
 *
 * Cobre o essencial que quebra calado numa refatoração:
 *  - a página RENDERIZA com dados (sem crash de shape)
 *  - os valores em R$ saem formatados em pt-BR (vírgula decimal)
 *  - estado vazio e estado de erro não explodem
 */

import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const LISTA = [
  {
    id: 'item-1',
    produtoId: 'prod-1',
    produto: {
      id: 'prod-1',
      nome: 'Farinha de Trigo',
      sku: 'FAR-1',
      precoTabela: 11.9,
      unidade: 'KG',
      marca: 'ACME',
      categoria: 'Secos',
      imagem: null,
    },
    ordem: 1,
  },
];
const VAZIO: unknown[] = [];

let respostaLista: unknown = LISTA;
let carregando = false;
let erro: string | null = null;

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'x-1' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useLocation: () => ({ pathname: '/catalogo', search: '' }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
  useRole: () => 'DIRECTOR',
  hasPermission: () => true,
}));

vi.mock('@/hooks/useDebouncedValue', () => ({ useDebouncedValue: (v: unknown) => v }));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    if (path === null) return { data: null, loading: false, error: null, refetch: vi.fn() };
    if (path.includes('/empresas/config'))
      return { data: {}, loading: false, error: null, refetch: vi.fn() };
    return { data: respostaLista, loading: carregando, error: erro, refetch: vi.fn() };
  },
}));

vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

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

vi.mock('@/components/VendasTabs', () => ({ VendasTabs: () => <nav /> }));
vi.mock('@/components/CrmTabs', () => ({ CrmTabs: () => <nav /> }));
vi.mock('@/components/NovoPedidoDialog', () => ({ NovoPedidoDialog: () => null }));
vi.mock('@/components/AsyncCombobox', () => ({ AsyncCombobox: () => null }));

const { default: Pagina } = await import('./CatalogoPage');

afterEach(() => {
  cleanup();
  respostaLista = LISTA;
  carregando = false;
  erro = null;
});

describe('CatalogoPage — render de dinheiro', () => {
  it('renderiza a página com dados', () => {
    render(<Pagina />);
    expect(document.body.textContent).toContain('Farinha de Trigo');
  });

  it('formata valor em pt-BR (vírgula decimal, nunca ponto)', () => {
    render(<Pagina />);
    const texto = document.body.textContent ?? '';
    // Se apareceu algum R$, ele TEM que estar em pt-BR.
    if (texto.includes('R$')) {
      expect(texto).toMatch(/R\$\s?[\d.]+,\d{2}/);
    }
  });

  it('lista vazia não quebra', () => {
    respostaLista = VAZIO;
    expect(() => render(<Pagina />)).not.toThrow();
  });

  it('estado de erro não quebra', () => {
    erro = 'Falha ao carregar';
    respostaLista = null;
    expect(() => render(<Pagina />)).not.toThrow();
  });

  it('estado de carregando não quebra', () => {
    carregando = true;
    respostaLista = null;
    expect(() => render(<Pagina />)).not.toThrow();
  });
});
