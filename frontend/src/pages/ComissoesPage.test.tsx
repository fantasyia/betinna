/**
 * ComissoesPage — spec de fumaça das páginas de DINHEIRO (auditoria: as 14 páginas onde
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
      id: 'com-1',
      tipo: 'REP',
      mes: 7,
      ano: 2026,
      totalVendas: 120000.9,
      totalComissao: 6000.05,
      qtdPedidos: 12,
      percentual: 5,
      pago: false,
      pagoEm: null,
      representante: { id: 'rep-1', nome: 'João' },
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

const EXTRATO_PADRAO = {
  totais: {
    AGUARDANDO_ENVIO: 100.5,
    AGUARDANDO_MENSALIDADE: 12.1,
    A_PAGAR: 250,
    PAGA: 999.99,
    CANCELADA: 0,
  },
  linhas: [
    {
      id: 'pc-1',
      tipo: 'VENDA',
      referencia: 'PED-0057',
      cliente: 'Indústria Alfa',
      competencia: '2026-09',
      base: 2500,
      percentual: 10,
      valor: 250,
      fase: 'A_PAGAR',
      faseRotulo: 'A pagar em 05/10',
      previsaoPagamentoEm: '2026-10-05',
      pagoEm: null,
    },
    {
      id: 'cc-1',
      tipo: 'LOCACAO',
      referencia: 'PROP-0031 · 2026-10',
      cliente: 'Frigorífico Beta',
      competencia: '2026-10',
      base: 121,
      percentual: 10,
      valor: 12.1,
      fase: 'AGUARDANDO_MENSALIDADE',
      faseRotulo: 'Aguardando mensalidade',
      previsaoPagamentoEm: '2026-11-05',
      pagoEm: null,
    },
  ],
};
let extratoMock: unknown = EXTRATO_PADRAO;

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
    // Previsao do mes: shape REAL de `GET /comissoes/minha-previsao`.
    if (path.includes('minha-previsao'))
      return {
        data: {
          mes: 7,
          ano: 2026,
          base: 120000.9,
          valor: 6000.05,
          qtdPedidos: 2,
          previsaoPagamentoEm: '2026-08-05',
          fechado: false,
          pedidos: [
            {
              pedidoId: 'ped-1',
              numero: 'PED-0001',
              cliente: 'Industria X',
              data: '2026-07-10T12:00:00.000Z',
              totalPedido: 100000,
              comissao: 5000,
            },
          ],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    if (path.includes('minhas-recebidas'))
      return {
        data: {
          total: 12000.1,
          itens: [
            {
              id: 'com-9',
              mes: 6,
              ano: 2026,
              tipo: 'REP',
              totalVendas: 200000,
              totalComissao: 12000.1,
              qtdPedidos: 5,
              pagoEm: '2026-07-05T12:00:00.000Z',
              previsaoPagamentoEm: '2026-07-05',
            },
          ],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    // Resumo pessoal do rep: shape REAL de `GET /comissoes/meu-resumo`.
    // ⚠️ Este mock já foi um chute (`mesAtual`/`ultimos12Meses`, campos que a
    // API nunca devolveu) — e como o teste mockava o mesmo chute da tela, ele
    // passava enquanto a página quebrava na mão do rep. Mock de contrato tem
    // que copiar o backend, não a expectativa do front.
    // `GET /comissoes/meu-extrato` — shape REAL do ComissaoRepVisaoService.
    // Copiado do backend, não da expectativa da tela (o comentário abaixo conta
    // por que esse cuidado existe).
    if (path.includes('meu-extrato'))
      return {
        data: extratoMock,
        loading: carregando,
        error: erro,
        refetch: vi.fn(),
      };
    if (path.includes('meu-resumo'))
      return {
        data: {
          representanteId: 'rep-1',
          anoAtual: 2026,
          totalRecebidoAnoAtual: 12000.1,
          totalAReceberAnoAtual: 6000.05,
          historico: [
            {
              id: 'com-1',
              tipo: 'REP',
              mes: 7,
              ano: 2026,
              totalVendas: 120000.9,
              totalComissao: 6000.05,
              percentual: 5,
              pago: false,
            },
          ],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
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

const { default: Pagina } = await import('./ComissoesPage');

afterEach(() => {
  cleanup();
  respostaLista = LISTA;
  carregando = false;
  erro = null;
});

describe('ComissoesPage — o resumo do REP', () => {
  it('renderiza o resumo pessoal com os números da API (sem crash de shape)', async () => {
    // A regressão real: a tela lia `data.mesAtual.valor`, que não existe no
    // contrato — e um TypeError derrubava a página inteira do representante.
    const { render: r2, screen } = await import('@testing-library/react');
    r2(<Pagina />);
    expect(screen.getAllByTestId('comissao-historico').length).toBeGreaterThan(0);
    const texto = document.body.textContent ?? '';
    expect(texto).toContain('Minhas comissões');
    expect(texto).toContain('A receber em 2026');
  });

  it('mostra a PREVISÃO do mês e a data em que ela cai', async () => {
    // O rep passava o mês inteiro sem ver o que vendeu: o número só existia
    // depois do fechamento. A data é a outra metade da pergunta dele.
    const { render: r2, screen } = await import('@testing-library/react');
    r2(<Pagina />);
    expect(screen.getByTestId('comissao-previsao-valor').textContent).toContain('6.000,05');
    expect(document.body.textContent).toContain('05/08/2026');
  });

  it('visão DETALHADA abre o pedido a pedido (é o que ele confere)', async () => {
    const { render: r2, screen } = await import('@testing-library/react');
    const { fireEvent } = await import('@testing-library/react');
    r2(<Pagina />);
    expect(screen.queryByTestId('comissao-previsao-detalhe')).toBeNull();
    fireEvent.click(screen.getByTestId('comissao-visao-detalhado'));
    expect(screen.getByTestId('comissao-previsao-detalhe').textContent).toContain('PED-0001');
  });

  it('aba RECEBIDAS lista o que já caiu, com filtro de período', async () => {
    const { render: r2, screen } = await import('@testing-library/react');
    const { fireEvent } = await import('@testing-library/react');
    r2(<Pagina />);
    fireEvent.click(screen.getByTestId('comissao-aba-recebidas'));
    expect(screen.getByTestId('comissao-recebidas-de')).toBeTruthy();
    expect(screen.getByTestId('comissao-recebidas-lista').textContent).toContain('05/07/2026');
  });
});

describe('ComissoesPage — render de dinheiro', () => {
  it('renderiza a página com dados', () => {
    render(<Pagina />);
    expect(document.body.textContent).toContain('João');
  });

  it('nunca formata dinheiro em en-US (R$ 1234.56)', () => {
    // A regressão real é o `toLocaleString`/`toFixed` cru voltando pro código —
    // aí o decimal vira PONTO. O formato compacto ("R$ 45,0 mil") é válido, então
    // o que se afirma é a AUSÊNCIA do padrão en-US, não a presença de um só.
    render(<Pagina />);
    const texto = document.body.textContent ?? '';
    expect(texto).not.toMatch(/R\$\s?\d+\.\d{2}(\D|$)/);
  });

  it('extrato: mostra os totais por fase e as duas origens na lista', () => {
    extratoMock = EXTRATO_PADRAO;
    // O spec usa `container.textContent` (sem jest-dom) — mesma receita do resto.
    const { container } = render(<Pagina />);
    const texto = container.textContent ?? '';

    // Venda e locação convivem — pro rep é tudo "o que eu tenho a receber".
    expect(texto).toContain('PED-0057');
    expect(texto).toContain('PROP-0031');
    expect(texto).toContain('A pagar em 05/10');
    expect(texto).toContain('Aguardando mensalidade');
    // Totais por fase no topo, em pt-BR. O `Intl` separa "R$" do número com
    // espaço NÃO SEPARÁVEL (U+00A0) — comparar com espaço comum falha aqui.
    expect(texto).toMatch(/R\$\s?999,99/);
  });

  it('extrato: payload PARCIAL não derruba a tela', () => {
    // Aconteceu de verdade: `data` truthy sem `linhas` fazia a página inteira
    // quebrar — e comissão é a tela em que o rep confere o próprio dinheiro.
    extratoMock = {};
    expect(() => render(<Pagina />)).not.toThrow();
    extratoMock = EXTRATO_PADRAO;
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
