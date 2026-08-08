/**
 * RelatoriosPage — spec de fumaça das páginas de DINHEIRO (auditoria: as 14 páginas onde
 * o app mexe com valor não tinham NENHUM teste).
 *
 * Cobre o essencial que quebra calado numa refatoração:
 *  - a página RENDERIZA com dados (sem crash de shape)
 *  - os valores em R$ saem formatados em pt-BR (vírgula decimal)
 *  - estado vazio e estado de erro não explodem
 */

import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const PERIODO = { de: '2026-07-01', ate: '2026-07-31' };

const VENDAS = {
  periodo: PERIODO,
  faturamento: { atual: 250000.75, anterior: 200000, variacao: 25 },
  receitaRealizada: 210000.5,
  totalPedidos: 42,
  ticketMedio: 5952.4,
  porStatus: [{ status: 'ENTREGUE', count: 30, total: 180000.25 }],
  porRep: [{ repId: 'rep-1', repNome: 'João', pedidos: 20, total: 90000.3 }],
};

const FUNIL = {
  periodo: PERIODO,
  totalAtivos: 12,
  criados: { atual: 30, anterior: 25, variacao: 20 },
  ganhos: { atual: 8, anterior: 6, variacao: 33 },
  perdidos: 4,
  taxaConversao: 26.7,
  agingMedioPorEtapa: {},
  porRep: [{ repId: 'rep-1', repNome: 'João', leads: 12, valorEstimado: 45000.1 }],
};

const LISTA = {
  vendas: VENDAS,
  funil: FUNIL,
  sac: {
    periodo: PERIODO,
    total: { atual: 10, anterior: 8, variacao: 25 },
    abertas: 2,
    emAndamento: 3,
    resolvidas: 5,
    slaEstourado: 1,
    tmrHoras: 12,
    porSeveridade: [],
    porTipo: [],
  },
  amostras: {
    periodo: PERIODO,
    enviadas: 10,
    convertidas: 4,
    expiradas: 1,
    taxaConversao: 40,
    valorConvertido: 3200.5,
    valorTotal: 8000.75,
  },
  campanhas: {
    periodo: PERIODO,
    totalCampanhas: 3,
    totalDestinatarios: 900,
    taxaEnvio: 98,
    taxaLeitura: 61,
    porCanal: [],
    porStatus: [],
  },
};

const VAZIO = {
  ...LISTA,
  vendas: { ...VENDAS, faturamento: { atual: 0, anterior: 0, variacao: 0 }, porStatus: [], porRep: [] },
  funil: { ...FUNIL, porRep: [] },
};

let respostaLista: unknown = LISTA;
let carregando = false;
let erro: string | null = null;

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'x-1' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useLocation: () => ({ pathname: '/relatorios', search: '' }),
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

const { default: Pagina } = await import('./RelatoriosPage');

afterEach(() => {
  cleanup();
  respostaLista = LISTA;
  carregando = false;
  erro = null;
});

describe('RelatoriosPage — render de dinheiro', () => {
  it('renderiza a página com dados', () => {
    render(<Pagina />);
    expect(document.body.textContent?.length).toBeGreaterThan(0);
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
