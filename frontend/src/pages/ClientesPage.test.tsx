/**
 * ClientesPage — spec de fumaça das páginas de DINHEIRO (auditoria: as 14 páginas onde
 * o app mexe com valor não tinham NENHUM teste).
 *
 * Cobre o essencial que quebra calado numa refatoração:
 *  - a página RENDERIZA com dados (sem crash de shape)
 *  - os valores em R$ saem formatados em pt-BR (vírgula decimal)
 *  - estado vazio e estado de erro não explodem
 */

import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const LISTA = {
  data: [
    {
      id: 'cli-1',
      nome: 'Padaria do João',
      cnpj: '12.345.678/0001-90',
      cidade: 'São Paulo',
      uf: 'SP',
      segmento: 'Padaria',
      status: 'ATIVO',
      omieStatus: 'ATIVO',
      score: 70,
      email: 'j@x.com',
      telefone: '11999990000',
      limiteCredito: 5000.75,
      representante: { id: 'rep-1', nome: 'João' },
      tags: [],
      criadoEm: '2026-01-01T00:00:00.000Z',
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};
const VAZIO = { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

let respostaLista: unknown = LISTA;
let carregando = false;
let erro: string | null = null;

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'x-1' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useLocation: () => ({ pathname: '/', search: '' }),
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
    // Facetas/filtros auxiliares: shape próprio, não é a lista.
    if (path.includes('/facets'))
      return {
        data: { linhas: [], marcas: [], categorias: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    if (path.includes('/listas'))
      return { data: [], loading: false, error: null, refetch: vi.fn() };
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

const { default: Pagina } = await import('./ClientesPage');

afterEach(() => {
  cleanup();
  respostaLista = LISTA;
  carregando = false;
  erro = null;
});

describe('ClientesPage — render de dinheiro', () => {
  it('renderiza a página com dados', () => {
    render(<Pagina />);
    expect(document.body.textContent).toContain('Padaria do João');
  });

  it('nunca formata dinheiro em en-US (R$ 1234.56)', () => {
    // A regressão real é o `toLocaleString`/`toFixed` cru voltando pro código —
    // aí o decimal vira PONTO. O formato compacto ("R$ 45,0 mil") é válido, então
    // o que se afirma é a AUSÊNCIA do padrão en-US, não a presença de um só.
    render(<Pagina />);
    const texto = document.body.textContent ?? '';
    expect(texto).not.toMatch(/R\$\s?\d+\.\d{2}(\D|$)/);
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
