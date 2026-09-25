import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PropostaAceitePage, { dataPura } from './PropostaAceitePage';

/**
 * Página que o CLIENTE abre (Léo, 25/09): o levantamento no formato do
 * documento aprovado, o PROJETO pra abrir e o aceite. Antes era uma tabela
 * genérica sem quadros, prazos, condições — e sem o projeto que ele "aprova".
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
  },
  apiErrorMessage: (e: unknown) => String(e),
}));
vi.mock('react-router-dom', () => ({ useParams: () => ({ token: 'tok-27' }) }));
vi.mock('@/lib/marca', async () => {
  const real = await vi.importActual<typeof import('@/lib/marca')>('@/lib/marca');
  const m = {
    ...real.MARCA_PADRAO,
    nome: 'Empresa X',
    logoNegativoUrl: 'https://x/logo-branca.png',
    cores: { primaria: '#00416E', secundaria: '#008CC8', acao: '#F39200' },
  };
  return { ...real, marca: () => m, carregarMarca: vi.fn(async () => m) };
});

const RESUMO = {
  numero: 'PROP-0027',
  criadaEm: '2026-09-25T15:00:00.000Z',
  validoAte: '2026-10-24T00:00:00.000Z',
  cliente: {
    razaoSocial: 'INDÚSTRIA TESTE CONTRATO LTDA',
    cnpj: '76.851.812/0001-02',
    endereco: 'Avenida Paulista, 1000 · Bela Vista · São Paulo/SP · CEP 01310-100',
  },
  signatarioNome: 'Leonardo Beltran',
  quadros: [
    { quadro: 'QGBT', principal: true, tensaoV: 380, correnteA: 420, modelo: 'Master Block MB-04 + Data Sense', aluguelMensal: 874 },
    { quadro: 'Painel Iluminação', principal: false, tensaoV: 220, correnteA: 63, modelo: 'Master Block MB-01', aluguelMensal: 121 },
  ],
  aluguelMensalTotal: 995,
  condicoes: { vigenciaMeses: 60, diaVencimento: 5, primeiroAluguelNoMes: 2, garantiaMeses: 60 },
  servicos: { customizacao: { quantidade: 1, unitario: 1500, total: 1500 }, total: 12000, parcelas: 2, valorParcela: 6000 },
  prazos: { entregaDias: 45, instalacaoDias: 15, verificacaoDias: 5, softwareDias: 7 },
};
const PREVIEW = {
  numero: 'PROP-0027',
  empresaNome: 'Empresa X',
  clienteNome: 'INDÚSTRIA TESTE CONTRATO LTDA',
  status: 'AGUARDANDO_ASSINATURA',
  validoAte: '2026-10-24T00:00:00.000Z',
  formaPagamento: 'PIX',
  condicaoPagamento: null,
  subtotal: 995,
  descontoGeral: 0,
  valor: 995,
  observacoes: null,
  jaRespondida: false,
  itens: [],
  resumo: RESUMO,
  anexos: [{ id: 'an-1', nome: 'projeto-PROP-0027.pdf', mime: 'application/pdf', tamanho: 175532 }],
  rodape: 'Empresa X · CNPJ 00 · contato@x\nRua Y, 1 · São Paulo',
};

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});
afterEach(() => cleanup());

describe('PropostaAceitePage', () => {
  it('mostra o levantamento: quadros com o principal marcado, total POR MÊS, condições e prazos', async () => {
    apiGet.mockResolvedValue(PREVIEW);
    render(<PropostaAceitePage />);
    await waitFor(() => expect(screen.getByTestId('aceite-quadros')).toBeTruthy());

    const linhas = screen.getByTestId('aceite-quadros').querySelectorAll('tbody tr');
    expect(linhas).toHaveLength(2);
    expect(linhas[0].textContent).toContain('QGBTprincipal');
    expect(linhas[0].textContent).toContain('Master Block MB-04 + Data Sense');
    expect(screen.getByTestId('aceite-total-mensal').textContent).toMatch(/R\$\s995,00 \/ mês/);
    expect(screen.getByTestId('aceite-condicoes').textContent).toContain('dia 05');
    expect(screen.getByTestId('aceite-condicoes').textContent).toContain('2º mês');
    expect(screen.getByTestId('aceite-prazos').textContent).toContain('45 dias');
    // Validade sem fuso: 24/10, não 23/10.
    expect(document.body.textContent).toContain('24/10/2026');
    expect(screen.getByTestId('aceite-rodape').textContent).toContain('contato@x');
  });

  it('o PROJETO aparece e abre pelo link público do token', async () => {
    apiGet.mockImplementation(async (url: string) =>
      url.includes('/anexos/') ? { url: 'https://storage/projeto.pdf' } : PREVIEW,
    );
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<PropostaAceitePage />);
    await waitFor(() => expect(screen.getByTestId('aceite-projeto')).toBeTruthy());

    fireEvent.click(screen.getByTestId('aceite-abrir-projeto-an-1'));
    await waitFor(() => expect(abrir).toHaveBeenCalledWith('https://storage/projeto.pdf', '_blank', 'noopener'));
    expect(apiGet).toHaveBeenCalledWith('/propostas/aceite/tok-27/anexos/an-1', { skipAuth: true });
    abrir.mockRestore();
  });

  it('aprovar chama o endpoint público de decisão', async () => {
    apiGet.mockResolvedValue(PREVIEW);
    apiPost.mockResolvedValue({ status: 'ACEITA' });
    render(<PropostaAceitePage />);
    await waitFor(() => expect(screen.getByTestId('aceite-aprovar')).toBeTruthy());

    fireEvent.click(screen.getByTestId('aceite-aprovar'));
    await waitFor(() => expect(screen.getByTestId('aceite-resultado')).toBeTruthy());
    expect(apiPost).toHaveBeenCalledWith('/propostas/aceite/tok-27/decidir', { decisao: 'ACEITA' }, { skipAuth: true });
  });

  it('já respondida: avisa, e não mostra projeto nem botões', async () => {
    apiGet.mockResolvedValue({ ...PREVIEW, jaRespondida: true, resumo: null, anexos: [] });
    render(<PropostaAceitePage />);
    await waitFor(() => expect(screen.getByTestId('aceite-ja-respondida')).toBeTruthy());
    expect(screen.queryByTestId('aceite-decisao')).toBeNull();
    expect(screen.queryByTestId('aceite-projeto')).toBeNull();
  });

  it('dataPura não desloca o dia', () => {
    expect(dataPura('2026-10-24T00:00:00.000Z')).toBe('24/10/2026');
    expect(dataPura(null)).toBe('—');
  });
});
