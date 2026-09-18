/**
 * Levantamento de campo → proposta.
 *
 * O que vale testar aqui não é o layout: é que a tela NÃO deixe sair uma
 * proposta errada. Três coisas quebram calado numa refatoração e custam caro no
 * mundo real:
 *
 *  - a variante mandada ao backend (base / Data Sense / End Point) — errar põe
 *    um equipamento de preço bem diferente no contrato;
 *  - o levantamento chegar junto dos itens — sem ele o Anexo II sai vazio;
 *  - a recusa do seletor aparecer em vez de um modelo chutado.
 */

import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const navegou = vi.fn();
const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navegou,
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useLocation: () => ({ pathname: '/levantamento', search: '' }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
  useRole: () => 'REP',
  hasPermission: () => true,
}));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: null, loading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// O combobox tem busca própria com debounce e clique-fora; aqui ele só precisa
// conseguir escolher um cliente.
vi.mock('@/components/AsyncCombobox', () => ({
  AsyncCombobox: ({ onChange, testId }: { onChange: (v: unknown) => void; testId?: string }) => (
    <button data-testid={testId} onClick={() => onChange({ id: 'cli-1', nome: 'Alfa', cnpj: null })}>
      escolher cliente
    </button>
  ),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
  },
  ApiError: class extends Error {},
  apiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import LevantamentoCampoPage from './LevantamentoCampoPage';

const MB04 = {
  ok: true,
  modelo: {
    produtoId: 'p-4',
    sku: 'MB-04',
    nome: 'Master Block MB-04',
    correnteMinA: 401,
    correnteMaxA: 500,
  },
};
const MB04_DS = {
  ok: true,
  modelo: { ...MB04.modelo, produtoId: 'p-4d', sku: 'MB-04_D.S.' },
};

/** Preenche um quadro e adiciona à lista. */
async function medirQuadro(nome: string, correnteA: string, resposta: unknown) {
  apiGet.mockResolvedValueOnce(resposta);
  fireEvent.change(screen.getByTestId('levantamento-quadro'), { target: { value: nome } });
  fireEvent.change(screen.getByTestId('levantamento-corrente'), { target: { value: correnteA } });
  fireEvent.click(screen.getByTestId('levantamento-consultar'));
  await waitFor(() =>
    expect((screen.getByTestId('levantamento-adicionar') as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByTestId('levantamento-adicionar'));
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
  navegou.mockReset();
});

describe('LevantamentoCampoPage', () => {
  it('renderiza sem dados', () => {
    render(<LevantamentoCampoPage />);
    expect(screen.getByTestId('levantamento-quadro')).toBeTruthy();
    // Sem cliente e sem quadro, não há proposta a gerar.
    expect((screen.getByTestId('levantamento-gerar') as HTMLButtonElement).disabled).toBe(true);
  });

  it('consulta o modelo pela corrente e mostra a faixa', async () => {
    apiGet.mockResolvedValueOnce(MB04);
    render(<LevantamentoCampoPage />);

    fireEvent.change(screen.getByTestId('levantamento-corrente'), { target: { value: '420' } });
    fireEvent.click(screen.getByTestId('levantamento-consultar'));

    await waitFor(() => expect(screen.getByTestId('levantamento-previa')).toBeTruthy());
    expect(screen.getByTestId('levantamento-previa').textContent).toContain('MB-04');
    expect(apiGet.mock.calls[0][0]).toContain('correnteA=420');
  });

  /**
   * 🔴 As três variantes têm a MESMA faixa de corrente e preços bem diferentes.
   * Se a tela mandar a variante errada, o backend devolve um modelo legítimo
   * para aquela corrente — e nada acusa.
   */
  it.each([
    [false, false, 'variante=BASE'],
    [true, false, 'variante=END_POINT'],
    [true, true, 'variante=DATA_SENSE'],
  ])('acompanhamento=%s principal=%s → %s', async (acomp, principal, esperado) => {
    apiGet.mockResolvedValue(MB04);
    render(<LevantamentoCampoPage />);

    if (acomp) fireEvent.click(screen.getByTestId('levantamento-acompanhamento'));
    if (principal) fireEvent.click(screen.getByTestId('levantamento-principal'));
    fireEvent.change(screen.getByTestId('levantamento-corrente'), { target: { value: '420' } });
    fireEvent.click(screen.getByTestId('levantamento-consultar'));

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls.at(-1)?.[0]).toContain(esperado);
  });

  it('"quadro principal" só existe com acompanhamento marcado', () => {
    render(<LevantamentoCampoPage />);
    expect((screen.getByTestId('levantamento-principal') as HTMLButtonElement).disabled).toBe(true);
  });

  /**
   * ⛔ A recusa do backend tem que VIRAR TEXTO. Mostrar um modelo qualquer aqui
   * seria vender equipamento que não protege a instalação.
   */
  it('corrente acima da linha mostra o motivo e NÃO deixa adicionar', async () => {
    apiGet.mockResolvedValueOnce({ ok: false, motivo: 'acima-da-linha' });
    render(<LevantamentoCampoPage />);

    fireEvent.change(screen.getByTestId('levantamento-corrente'), { target: { value: '7200' } });
    fireEvent.click(screen.getByTestId('levantamento-consultar'));

    await waitFor(() => expect(screen.getByTestId('levantamento-recusa')).toBeTruthy());
    expect(screen.getByTestId('levantamento-recusa').textContent).toContain('projeto especial');
    expect(screen.queryByTestId('levantamento-previa')).toBeNull();
    expect((screen.getByTestId('levantamento-adicionar') as HTMLButtonElement).disabled).toBe(true);
  });

  it('manda o levantamento junto dos itens ao gerar a proposta', async () => {
    apiPost.mockResolvedValue({ id: 'prop-9', numero: 'PROP-0009' });
    render(<LevantamentoCampoPage />);

    fireEvent.click(screen.getByTestId('levantamento-cliente'));
    fireEvent.change(screen.getByTestId('levantamento-tensao'), { target: { value: '380' } });
    await medirQuadro('QGBT', '420', MB04);

    fireEvent.click(screen.getByTestId('levantamento-gerar'));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const corpo = apiPost.mock.calls[0][1] as { itens: Array<Record<string, unknown>> };
    // Sem estes três campos o Anexo II sai com a tabela vazia, e nada quebra.
    expect(corpo.itens[0]).toMatchObject({
      produtoId: 'p-4',
      quadroPainel: 'QGBT',
      tensaoV: 380,
      correnteA: 420,
    });
  });

  /**
   * 🔴 O End Point é a comunicação até o Data Sense. Sem o concentrador ele não
   * tem com quem falar — e isso só apareceria depois de instalado.
   */
  it('barra End Point sem Data Sense antes de chamar a API', async () => {
    render(<LevantamentoCampoPage />);
    fireEvent.click(screen.getByTestId('levantamento-cliente'));

    fireEvent.click(screen.getByTestId('levantamento-acompanhamento'));
    await medirQuadro('Painel 3', '420', {
      ok: true,
      modelo: { ...MB04.modelo, produtoId: 'p-4e', sku: 'MB-04_E.P.' },
    });

    expect(screen.getByTestId('levantamento-topologia').textContent).toContain('Data Sense');
    expect((screen.getByTestId('levantamento-gerar') as HTMLButtonElement).disabled).toBe(true);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('barra dois Data Sense — é um por instalação', async () => {
    render(<LevantamentoCampoPage />);
    fireEvent.click(screen.getByTestId('levantamento-cliente'));

    fireEvent.click(screen.getByTestId('levantamento-acompanhamento'));
    fireEvent.click(screen.getByTestId('levantamento-principal'));
    await medirQuadro('QGBT', '420', MB04_DS);

    fireEvent.click(screen.getByTestId('levantamento-acompanhamento'));
    fireEvent.click(screen.getByTestId('levantamento-principal'));
    await medirQuadro('QGBT 2', '420', MB04_DS);

    expect(screen.getByTestId('levantamento-topologia').textContent).toContain('um por instalação');
    expect((screen.getByTestId('levantamento-gerar') as HTMLButtonElement).disabled).toBe(true);
  });

  it('um Data Sense com um End Point passa', async () => {
    apiPost.mockResolvedValue({ id: 'prop-9', numero: 'PROP-0009' });
    render(<LevantamentoCampoPage />);
    fireEvent.click(screen.getByTestId('levantamento-cliente'));

    fireEvent.click(screen.getByTestId('levantamento-acompanhamento'));
    fireEvent.click(screen.getByTestId('levantamento-principal'));
    await medirQuadro('QGBT', '420', MB04_DS);

    fireEvent.click(screen.getByTestId('levantamento-acompanhamento'));
    await medirQuadro('Painel 3', '420', {
      ok: true,
      modelo: { ...MB04.modelo, produtoId: 'p-4e', sku: 'MB-04_E.P.' },
    });

    expect(screen.queryByTestId('levantamento-topologia')).toBeNull();
    expect((screen.getByTestId('levantamento-gerar') as HTMLButtonElement).disabled).toBe(false);
  });

  it('erro do backend aparece na tela, com a mensagem dele', async () => {
    apiPost.mockRejectedValue(new Error('Produto "MB-04" está inativo'));
    render(<LevantamentoCampoPage />);
    fireEvent.click(screen.getByTestId('levantamento-cliente'));
    await medirQuadro('QGBT', '420', MB04);

    fireEvent.click(screen.getByTestId('levantamento-gerar'));

    await waitFor(() => expect(screen.getByTestId('levantamento-erro')).toBeTruthy());
    expect(screen.getByTestId('levantamento-erro').textContent).toContain('está inativo');
    expect(navegou).not.toHaveBeenCalled();
  });
});
