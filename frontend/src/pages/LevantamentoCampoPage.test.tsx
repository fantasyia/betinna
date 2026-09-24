/**
 * Levantamento de campo → proposta.
 *
 * O que vale testar aqui não é layout: é que a tela não deixe sair proposta
 * errada, e que o levantamento NÃO SE PERCA. Quatro coisas quebram calado numa
 * refatoração e custam caro no mundo real:
 *
 *  - a variante mandada ao backend (base / Data Sense / End Point) — errar põe
 *    um equipamento de preço bem diferente no contrato;
 *  - cada quadro ser gravado na hora — em campo, fechar a aba não pode custar a
 *    medição inteira;
 *  - o levantamento chegar junto do item — sem ele o Anexo II sai vazio;
 *  - a recusa do seletor aparecer em vez de um modelo chutado.
 */

import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const navegou = vi.fn();
const setParams = vi.fn();
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
let busca = new URLSearchParams();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navegou,
  useParams: () => ({}),
  useSearchParams: () => [busca, setParams],
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

vi.mock('@/components/VendasTabs', () => ({ VendasTabs: () => <nav /> }));

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
    patch: (...a: unknown[]) => apiPatch(...a),
    delete: (...a: unknown[]) => apiDelete(...a),
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
const MB04_DS = { ok: true, modelo: { ...MB04.modelo, produtoId: 'p-4d', sku: 'MB-04_D.S.' } };
const MB04_EP = { ok: true, modelo: { ...MB04.modelo, produtoId: 'p-4e', sku: 'MB-04_E.P.' } };

const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  produtoNome: 'Master Block MB-04',
  quadroPainel: 'QGBT',
  tensaoV: 380,
  correnteA: 420,
  ...over,
});

const proposta = (itens: unknown[] = [item()]) => ({
  id: 'prop-9',
  numero: 'PROP-0009',
  status: 'RASCUNHO',
  itens,
  cliente: { id: 'cli-1', nome: 'Alfa' },
});

/** Sem `?proposta=`, a tela só busca a lista de rascunhos. */
function semRascunhos() {
  apiGet.mockResolvedValue({ data: [] });
}

/** Mede um quadro e grava. */
async function medirQuadro(nome: string, correnteA: string, modelo: unknown, resposta: unknown) {
  apiGet.mockResolvedValueOnce(modelo);
  fireEvent.change(screen.getByTestId('levantamento-quadro'), { target: { value: nome } });
  fireEvent.change(screen.getByTestId('levantamento-corrente'), { target: { value: correnteA } });
  fireEvent.click(screen.getByTestId('levantamento-consultar'));
  await waitFor(() =>
    expect((screen.getByTestId('levantamento-adicionar') as HTMLButtonElement).disabled).toBe(false),
  );
  apiPost.mockResolvedValueOnce(resposta);
  fireEvent.click(screen.getByTestId('levantamento-adicionar'));
  await waitFor(() => expect(apiPost).toHaveBeenCalled());
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
  apiPatch.mockReset();
  apiDelete.mockReset();
  navegou.mockReset();
  setParams.mockReset();
  busca = new URLSearchParams();
});

describe('LevantamentoCampoPage', () => {
  it('renderiza sem dados', () => {
    semRascunhos();
    render(<LevantamentoCampoPage />);
    expect(screen.getByTestId('levantamento-quadro')).toBeTruthy();
    // Sem proposta ainda não há o que concluir nem prazos a combinar.
    expect(screen.queryByTestId('levantamento-concluir')).toBeNull();
    expect(screen.queryByTestId('levantamento-prazos')).toBeNull();
  });

  it('consulta o modelo pela corrente e mostra a faixa', async () => {
    semRascunhos();
    apiGet.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce(MB04);
    render(<LevantamentoCampoPage />);

    fireEvent.change(screen.getByTestId('levantamento-corrente'), { target: { value: '420' } });
    fireEvent.click(screen.getByTestId('levantamento-consultar'));

    await waitFor(() => expect(screen.getByTestId('levantamento-previa')).toBeTruthy());
    expect(screen.getByTestId('levantamento-previa').textContent).toContain('MB-04');
  });

  /**
   * 🔴 As três variantes têm a MESMA faixa de corrente e preços bem diferentes.
   * Mandar a variante errada devolve um modelo legítimo — e nada acusa.
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
    semRascunhos();
    render(<LevantamentoCampoPage />);
    expect((screen.getByTestId('levantamento-principal') as HTMLButtonElement).disabled).toBe(true);
  });

  it('corrente acima da linha mostra o motivo e NÃO deixa adicionar', async () => {
    apiGet
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ ok: false, motivo: 'acima-da-linha' });
    render(<LevantamentoCampoPage />);

    fireEvent.change(screen.getByTestId('levantamento-corrente'), { target: { value: '7200' } });
    fireEvent.click(screen.getByTestId('levantamento-consultar'));

    await waitFor(() => expect(screen.getByTestId('levantamento-recusa')).toBeTruthy());
    expect(screen.getByTestId('levantamento-recusa').textContent).toContain('projeto especial');
    expect((screen.getByTestId('levantamento-adicionar') as HTMLButtonElement).disabled).toBe(true);
    expect(apiPost).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 O LEVANTAMENTO NÃO PODE SE PERDER.
 *
 * O rep mede dentro do cliente, no celular. Se fechar a aba, acabar a bateria ou
 * cair a rede, tudo que foi medido tem que continuar lá.
 */
describe('o levantamento é salvo a cada quadro', () => {
  it('o PRIMEIRO quadro cria a proposta', async () => {
    semRascunhos();
    render(<LevantamentoCampoPage />);
    fireEvent.click(screen.getByTestId('levantamento-cliente'));
    fireEvent.change(screen.getByTestId('levantamento-tensao'), { target: { value: '380' } });

    await medirQuadro('QGBT', '420', MB04, proposta());

    expect(apiPost.mock.calls[0][0]).toBe('/propostas');
    const corpo = apiPost.mock.calls[0][1] as { itens: Array<Record<string, unknown>> };
    // Sem estes campos o Anexo II sai com a tabela vazia, e nada quebra.
    expect(corpo.itens[0]).toMatchObject({
      produtoId: 'p-4',
      quadroPainel: 'QGBT',
      tensaoV: 380,
      correnteA: 420,
    });
    // A URL passa a apontar pro rascunho: recarregar não perde nada.
    expect(setParams).toHaveBeenCalledWith({ proposta: 'prop-9' }, { replace: true });
  });

  it('o SEGUNDO quadro entra na proposta que já existe', async () => {
    semRascunhos();
    render(<LevantamentoCampoPage />);
    fireEvent.click(screen.getByTestId('levantamento-cliente'));

    await medirQuadro('QGBT', '420', MB04, proposta());
    await medirQuadro('Painel 3', '420', MB04, proposta([item(), item({ id: 'i2' })]));

    // Criar uma proposta nova a cada quadro geraria N propostas soltas.
    expect(apiPost.mock.calls[1][0]).toBe('/propostas/prop-9/itens');
    expect(apiPost.mock.calls[1][1]).toMatchObject({ quadroPainel: 'Painel 3' });
  });

  it('não grava quadro sem cliente escolhido', async () => {
    semRascunhos();
    apiGet.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce(MB04);
    render(<LevantamentoCampoPage />);

    fireEvent.change(screen.getByTestId('levantamento-quadro'), { target: { value: 'QGBT' } });
    fireEvent.change(screen.getByTestId('levantamento-corrente'), { target: { value: '420' } });
    fireEvent.click(screen.getByTestId('levantamento-consultar'));
    await waitFor(() =>
      expect((screen.getByTestId('levantamento-adicionar') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByTestId('levantamento-adicionar'));

    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.getByTestId('levantamento-erro').textContent).toContain('cliente');
  });

  it('lista os levantamentos em aberto pra retomar', async () => {
    apiGet.mockResolvedValue({
      data: [{ id: 'prop-1', numero: 'PROP-0001', status: 'RASCUNHO', itens: [item()] }],
    });
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByTestId('levantamento-rascunhos')).toBeTruthy());
    fireEvent.click(screen.getByTestId('retomar-prop-1'));
    expect(setParams).toHaveBeenCalledWith({ proposta: 'prop-1' });
  });

  it('retomando, carrega os quadros já medidos e os prazos', async () => {
    busca = new URLSearchParams('proposta=prop-9');
    apiGet.mockResolvedValue({
      ...proposta([item(), item({ id: 'i2', quadroPainel: 'Painel 3' })]),
      prazoEntregaDias: 45,
      prazoInstalacaoDias: 15,
      prazoSoftwareDias: 7,
    });
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByTestId('levantamento-lista')).toBeTruthy());
    expect(screen.getByTestId('levantamento-lista').querySelectorAll('tr').length).toBe(2);
    expect((screen.getByTestId('prazo-entrega') as HTMLInputElement).value).toBe('45');
    // Com proposta aberta, o cliente não é mais escolhível — trocá-lo mudaria de
    // quem é o levantamento no meio dele.
    expect(screen.queryByTestId('levantamento-cliente')).toBeNull();
    expect(screen.getByTestId('levantamento-cliente-fixo').textContent).toContain('PROP-0009');
  });

  it('remover quadro chama a API, não só some da tela', async () => {
    busca = new URLSearchParams('proposta=prop-9');
    apiGet.mockResolvedValue(proposta());
    apiDelete.mockResolvedValue(proposta([]));
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByTestId('levantamento-lista')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Remover QGBT'));

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/propostas/prop-9/itens/i1'));
  });
});

/** Os prazos do item 04 do Anexo II — o rep coleta com o cliente. */
describe('prazos do documento', () => {
  it('salva os três prazos na proposta', async () => {
    busca = new URLSearchParams('proposta=prop-9');
    apiGet.mockResolvedValue(proposta());
    apiPatch.mockResolvedValue({ ...proposta(), prazoEntregaDias: 45 });
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByTestId('levantamento-prazos')).toBeTruthy());
    fireEvent.change(screen.getByTestId('prazo-entrega'), { target: { value: '45' } });
    fireEvent.change(screen.getByTestId('prazo-instalacao'), { target: { value: '15' } });
    fireEvent.change(screen.getByTestId('prazo-software'), { target: { value: '7' } });
    fireEvent.click(screen.getByTestId('salvar-prazos'));

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch.mock.calls[0][1]).toMatchObject({
      prazoEntregaDias: 45,
      prazoInstalacaoDias: 15,
      prazoSoftwareDias: 7,
    });
  });

  it('prazo em branco não vira número', async () => {
    busca = new URLSearchParams('proposta=prop-9');
    apiGet.mockResolvedValue(proposta());
    apiPatch.mockResolvedValue(proposta());
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByTestId('levantamento-prazos')).toBeTruthy());
    fireEvent.change(screen.getByTestId('prazo-entrega'), { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('salvar-prazos'));

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    const corpo = apiPatch.mock.calls[0][1] as Record<string, unknown>;
    // ⛔ Zero seria um prazo — e sairia impresso no documento como se tivesse
    // sido combinado.
    expect(corpo.prazoInstalacaoDias).toBeUndefined();
  });
});

describe('topologia do acompanhamento', () => {
  it('barra End Point sem Data Sense', async () => {
    busca = new URLSearchParams('proposta=prop-9');
    apiGet.mockResolvedValue(proposta([item({ produtoNome: 'MB-04 + End Point' })]));
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByTestId('levantamento-topologia')).toBeTruthy());
    expect(screen.getByTestId('levantamento-topologia').textContent).toContain('Data Sense');
    expect((screen.getByTestId('levantamento-concluir') as HTMLButtonElement).disabled).toBe(true);
  });

  it('barra dois Data Sense', async () => {
    busca = new URLSearchParams('proposta=prop-9');
    apiGet.mockResolvedValue(
      proposta([
        item({ produtoNome: 'MB-04 + Data Sense' }),
        item({ id: 'i2', produtoNome: 'MB-01 + Data Sense' }),
      ]),
    );
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByTestId('levantamento-topologia')).toBeTruthy());
    expect(screen.getByTestId('levantamento-topologia').textContent).toContain('um por instalação');
  });

  it('um Data Sense com um End Point passa', async () => {
    busca = new URLSearchParams('proposta=prop-9');
    apiGet.mockResolvedValue(
      proposta([
        item({ produtoNome: 'MB-04 + Data Sense' }),
        item({ id: 'i2', produtoNome: 'MB-01 + End Point' }),
      ]),
    );
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByTestId('levantamento-concluir')).toBeTruthy());
    expect(screen.queryByTestId('levantamento-topologia')).toBeNull();
    expect((screen.getByTestId('levantamento-concluir') as HTMLButtonElement).disabled).toBe(false);
  });

  it('erro do backend aparece com a mensagem dele', async () => {
    semRascunhos();
    render(<LevantamentoCampoPage />);
    fireEvent.click(screen.getByTestId('levantamento-cliente'));

    apiGet.mockResolvedValueOnce(MB04_EP);
    fireEvent.change(screen.getByTestId('levantamento-quadro'), { target: { value: 'Painel' } });
    fireEvent.change(screen.getByTestId('levantamento-corrente'), { target: { value: '420' } });
    fireEvent.click(screen.getByTestId('levantamento-consultar'));
    await waitFor(() =>
      expect((screen.getByTestId('levantamento-adicionar') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    apiPost.mockRejectedValueOnce(new Error('End Point sem Data Sense'));
    fireEvent.click(screen.getByTestId('levantamento-adicionar'));

    await waitFor(() => expect(screen.getByTestId('levantamento-erro')).toBeTruthy());
    expect(screen.getByTestId('levantamento-erro').textContent).toContain('Data Sense');
  });

  it('o Data Sense é marcado na lista', async () => {
    busca = new URLSearchParams('proposta=prop-9');
    apiGet.mockResolvedValue(proposta([item({ produtoNome: 'MB-04 + Data Sense' })]));
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByText('principal')).toBeTruthy());
  });

  it('MB04_DS existe como fixture coerente', () => {
    expect(MB04_DS.modelo.sku).toBe('MB-04_D.S.');
  });
});

/**
 * Documento único (Anexo I, 24/09): o QUARTO prazo e os serviços de
 * implantação — valor único, separado do aluguel mensal.
 */
describe('verificação e serviços de implantação', () => {
  it('salva o prazo de verificação e os serviços em NÚMERO (reais, não centavos)', async () => {
    busca = new URLSearchParams('proposta=prop-9');
    apiGet.mockResolvedValue(proposta());
    apiPatch.mockResolvedValue(proposta());
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByTestId('levantamento-prazos')).toBeTruthy());
    fireEvent.change(screen.getByTestId('prazo-verificacao'), { target: { value: '5' } });
    // A máscara trabalha em centavos: digitar 150000 é R$ 1.500,00.
    fireEvent.change(screen.getByTestId('custom-unitario'), { target: { value: '150000' } });
    fireEvent.change(screen.getByTestId('custom-quantidade'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('servicos-total'), { target: { value: '1200000' } });
    fireEvent.click(screen.getByTestId('salvar-prazos'));

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch.mock.calls[0][1]).toMatchObject({
      prazoVerificacaoDias: 5,
      customizacaoUnitario: 1500,
      customizacaoQuantidade: 2,
      servicosTotal: 12000,
    });
  });

  it('retomando, mostra os serviços já gravados formatados', async () => {
    busca = new URLSearchParams('proposta=prop-9');
    apiGet.mockResolvedValue({
      ...proposta(),
      prazoVerificacaoDias: 5,
      servicosTotal: 12000.5,
      customizacaoUnitario: 1500,
      customizacaoQuantidade: 1,
    });
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByTestId('levantamento-prazos')).toBeTruthy());
    expect((screen.getByTestId('prazo-verificacao') as HTMLInputElement).value).toBe('5');
    expect((screen.getByTestId('servicos-total') as HTMLInputElement).value).toBe('12.000,50');
    expect((screen.getByTestId('custom-unitario') as HTMLInputElement).value).toBe('1.500,00');
  });

  it('avisa quando o total não divide em 2 parcelas iguais — o contrato recusaria', async () => {
    busca = new URLSearchParams('proposta=prop-9');
    apiGet.mockResolvedValue(proposta());
    render(<LevantamentoCampoPage />);

    await waitFor(() => expect(screen.getByTestId('levantamento-prazos')).toBeTruthy());
    fireEvent.change(screen.getByTestId('servicos-total'), { target: { value: '1200001' } });
    expect(screen.getByText(/Não divide em 2 parcelas iguais/)).toBeTruthy();

    fireEvent.change(screen.getByTestId('servicos-total'), { target: { value: '1200002' } });
    expect(screen.queryByText(/Não divide em 2 parcelas iguais/)).toBeNull();
    expect(screen.getByText(/2 parcelas de R\$\s?6\.000,01/)).toBeTruthy();
  });
});
