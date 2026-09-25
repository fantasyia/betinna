import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PropostaAceitePage, { dataPura, textoSobre } from './PropostaAceitePage';

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
const renderAsync = vi.fn(async (_b: Blob, alvo: HTMLElement) => {
  alvo.innerHTML = '<section class="docx">CLÁUSULA PRIMEIRA — OBJETO</section>';
});
// pdf.js não roda no jsdom: o componente vira um marcador com a URL recebida.
vi.mock('@/components/PdfPaginas', () => ({
  PdfPaginas: ({ url, testid }: { url: string; testid?: string }) => (
    <div data-testid={testid} data-url={url} />
  ),
}));
vi.mock('docx-preview', () => ({ renderAsync: (...a: unknown[]) => renderAsync(...(a as [Blob, HTMLElement])) }));
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

  /** "O contrato é o mesmo" (Léo, 25/09): lê o arquivo congelado, no navegador. */
  it('CONTRATO: "Ler o contrato" busca o arquivo congelado do token e mostra aqui', async () => {
    apiGet.mockImplementation(async (url: string) =>
      url.endsWith('/contrato')
        ? { url: 'https://storage/contrato.docx', nome: 'PROP-0027.docx' }
        : { ...PREVIEW, temContrato: true },
    );
    const blob = new Blob(['PK-docx']);
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }));
    vi.stubGlobal('fetch', fetchMock);
    render(<PropostaAceitePage />);
    await waitFor(() => expect(screen.getByTestId('aceite-contrato')).toBeTruthy());

    fireEvent.click(screen.getByTestId('aceite-ler-contrato'));
    await waitFor(() =>
      expect(screen.getByTestId('aceite-contrato-leitor').textContent).toContain('CLÁUSULA PRIMEIRA'),
    );
    expect(apiGet).toHaveBeenCalledWith('/propostas/aceite/tok-27/contrato', { skipAuth: true });
    expect(fetchMock).toHaveBeenCalledWith('https://storage/contrato.docx');
    expect(renderAsync.mock.calls[0][0]).toBe(blob);
    vi.unstubAllGlobals();
  });

  /** Léo, 25/09: o app GERA o levantamento; a página abre o PDF congelado. */
  it('LEVANTAMENTO gerado: abre o PDF congelado do token (e o anexo antigo some)', async () => {
    apiGet.mockImplementation(async (url: string) =>
      url.endsWith('/levantamento')
        ? { url: 'https://storage/lev.pdf', nome: 'PROP-0027-levantamento-tecnico.pdf' }
        : { ...PREVIEW, temLevantamento: true },
    );
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<PropostaAceitePage />);
    await waitFor(() => expect(screen.getByTestId('aceite-levantamento')).toBeTruthy());
    expect(screen.queryByTestId('aceite-projeto')).toBeNull();

    fireEvent.click(screen.getByTestId('aceite-abrir-levantamento'));
    await waitFor(() => expect(abrir).toHaveBeenCalledWith('https://storage/lev.pdf', '_blank', 'noopener'));
    expect(apiGet).toHaveBeenCalledWith('/propostas/aceite/tok-27/levantamento', { skipAuth: true });
    abrir.mockRestore();
  });

  /** Léo, 25/09: proposta e contrato no mesmo lugar, no mesmo formato, pra imprimir. */
  it('DOCUMENTOS: mostra os dois PDFs congelados, um embaixo do outro, e mais nada', async () => {
    apiGet.mockImplementation(async (url: string) =>
      url.endsWith('/documentos')
        ? {
            levantamento: { url: 'https://storage/lev.pdf', nome: 'l.pdf' },
            contrato: { url: 'https://storage/con.pdf', nome: 'c.pdf' },
          }
        : { ...PREVIEW, temDocumentos: true, temLevantamento: true, temContrato: true },
    );
    render(<PropostaAceitePage />);
    await waitFor(() => expect(screen.getByTestId('aceite-doc-contrato')).toBeTruthy());
    expect(screen.getByTestId('aceite-doc-levantamento').getAttribute('data-url')).toBe(
      'https://storage/lev.pdf',
    );
    expect(screen.getByTestId('aceite-doc-contrato').getAttribute('data-url')).toBe(
      'https://storage/con.pdf',
    );
    // O resumo em HTML e os leitores antigos saem: o documento É o PDF.
    expect(screen.queryByTestId('aceite-quadros')).toBeNull();
    expect(screen.queryByTestId('aceite-contrato')).toBeNull();
    expect(screen.queryByTestId('aceite-levantamento')).toBeNull();
    // Na ordem: levantamento, depois contrato.
    const lev = screen.getByTestId('aceite-doc-levantamento');
    const con = screen.getByTestId('aceite-doc-contrato');
    expect(lev.compareDocumentPosition(con) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('aceite-aprovar')).toBeTruthy();
  });

  it('"Baixar tudo" pede o PDF único (levantamento + contrato) do token', async () => {
    apiGet.mockImplementation(async (url: string) =>
      url.endsWith('/documento-completo')
        ? { filename: 'PROP-0027-proposta-e-contrato.pdf', base64: btoa('%PDF-1.7') }
        : url.endsWith('/documentos')
          ? {
              levantamento: { url: 'https://storage/lev.pdf', nome: 'l.pdf' },
              contrato: { url: 'https://storage/con.pdf', nome: 'c.pdf' },
            }
          : { ...PREVIEW, temDocumentos: true },
    );
    const criar = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: criar, revokeObjectURL: vi.fn() }));
    render(<PropostaAceitePage />);
    await waitFor(() => expect(screen.getByTestId('aceite-baixar-tudo')).toBeTruthy());
    fireEvent.click(screen.getByTestId('aceite-baixar-tudo'));
    await waitFor(() => expect(criar).toHaveBeenCalled());
    expect(apiGet).toHaveBeenCalledWith('/propostas/aceite/tok-27/documento-completo', {
      skipAuth: true,
    });
    vi.unstubAllGlobals();
  });

  it('sem contrato congelado (ou venda): não oferece leitura', async () => {
    apiGet.mockResolvedValue({ ...PREVIEW, temContrato: false });
    render(<PropostaAceitePage />);
    await waitFor(() => expect(screen.getByTestId('aceite-decisao')).toBeTruthy());
    expect(screen.queryByTestId('aceite-contrato')).toBeNull();
  });

  it('já respondida: avisa, e não mostra projeto nem botões', async () => {
    apiGet.mockResolvedValue({ ...PREVIEW, jaRespondida: true, resumo: null, anexos: [] });
    render(<PropostaAceitePage />);
    await waitFor(() => expect(screen.getByTestId('aceite-ja-respondida')).toBeTruthy());
    expect(screen.queryByTestId('aceite-decisao')).toBeNull();
    expect(screen.queryByTestId('aceite-projeto')).toBeNull();
    expect(screen.queryByTestId('aceite-contrato')).toBeNull();
  });

  it('dataPura não desloca o dia', () => {
    expect(dataPura('2026-10-24T00:00:00.000Z')).toBe('24/10/2026');
    expect(dataPura(null)).toBe('—');
  });

  it('botão de aprovar: texto escuro na cor de ação clara (laranja)', () => {
    expect(textoSobre('#F39200')).toBe('#0B1620');
    expect(textoSobre('#00416E')).toBe('#ffffff');
  });
});
