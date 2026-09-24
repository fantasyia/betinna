import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { ModeloContratoCard } from './ModeloContratoCard';

/**
 * Modelo do contrato trocado pela tela (24/09). Trava o que o diretor precisa
 * enxergar pra não mandar contrato errado: o que está em uso, POR QUE um
 * arquivo foi recusado, e que ativar pede confirmação.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
let resposta: unknown = null;
const refetch = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    api: {
      get: (...a: unknown[]) => apiGet(...a),
      post: (...a: unknown[]) => apiPost(...a),
    },
  };
});
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: resposta, loading: false, error: null, refetch }),
}));
vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const versao = (over: Record<string, unknown> = {}) => ({
  id: 'mc-2',
  versao: 2,
  nomeArquivo: 'contrato-rev.docx',
  tamanhoBytes: 1000,
  ativo: false,
  observacao: 'cláusula 7',
  criadoEm: '2026-09-24T10:00:00Z',
  ativadoEm: null,
  enviadoPor: 'Leandro',
  ativadoPor: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resposta = { emUso: null, padrao: { nome: 'p.docx', tamanhoBytes: 1 }, versoes: [] };
});
afterEach(() => cleanup());

describe('ModeloContratoCard', () => {
  it('sem versão ativa, diz que vale o padrão do app', () => {
    render(<ModeloContratoCard />);
    expect(screen.getByTestId('modelo-em-uso').textContent).toBe('Em uso: o modelo padrão do app');
  });

  it('com versão ativa, diz QUAL e quem ativou', () => {
    resposta = {
      emUso: 3,
      padrao: { nome: 'p.docx', tamanhoBytes: 1 },
      versoes: [versao({ id: 'mc-3', versao: 3, ativo: true, ativadoPor: 'Leandro', ativadoEm: '2026-09-24T12:00:00Z' })],
    };
    render(<ModeloContratoCard />);
    expect(screen.getByTestId('modelo-em-uso').textContent).toContain('versão 3, ativada por Leandro');
  });

  it('upload recusado mostra CADA problema do backend, um por linha', async () => {
    apiPost.mockRejectedValue(
      new ApiError(422, 'BUSINESS_RULE_VIOLATION', 'O modelo não foi aceito', [
        { message: 'falta a marcação {{prazo_software}}' },
        { message: '{{Cliente_cnpj}} não existe — erro de digitação?' },
      ]),
    );
    render(<ModeloContratoCard />);
    const arquivo = new File(['PK\u0003\u0004'], 'rev.docx', { type: 'application/octet-stream' });
    fireEvent.change(screen.getByTestId('modelo-arquivo'), { target: { files: [arquivo] } });
    fireEvent.click(screen.getByTestId('modelo-enviar'));

    await waitFor(() => expect(screen.getByTestId('modelo-problemas')).toBeTruthy());
    const itens = screen.getByTestId('modelo-problemas').querySelectorAll('li');
    expect([...itens].map((li) => li.textContent)).toEqual([
      'falta a marcação {{prazo_software}}',
      '{{Cliente_cnpj}} não existe — erro de digitação?',
    ]);
  });

  it('manda o arquivo em base64 PURO, sem o prefixo data:', async () => {
    apiPost.mockResolvedValue({ versao: 4 });
    render(<ModeloContratoCard />);
    const arquivo = new File(['abc'], 'rev.docx');
    fireEvent.change(screen.getByTestId('modelo-arquivo'), { target: { files: [arquivo] } });
    fireEvent.change(screen.getByTestId('modelo-observacao'), { target: { value: ' cláusula 9 ' } });
    fireEvent.click(screen.getByTestId('modelo-enviar'));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/modelos-contrato', {
      nomeArquivo: 'rev.docx',
      conteudoBase64: btoa('abc'),
      observacao: 'cláusula 9',
    });
    expect(refetch).toHaveBeenCalled();
  });

  it('ativar pede CONFIRMAÇÃO antes — e só então chama a API', async () => {
    resposta = { emUso: null, padrao: { nome: 'p.docx', tamanhoBytes: 1 }, versoes: [versao()] };
    apiPost.mockResolvedValue({ emUso: 2 });
    render(<ModeloContratoCard />);

    fireEvent.click(screen.getByTestId('modelo-ativar-2'));
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('modelo-confirmar-ativacao'));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/modelos-contrato/mc-2/ativar'));
  });

  it('com versão ativa, oferece voltar ao padrão (também com confirmação)', async () => {
    resposta = {
      emUso: 2,
      padrao: { nome: 'p.docx', tamanhoBytes: 1 },
      versoes: [versao({ ativo: true })],
    };
    apiPost.mockResolvedValue({ emUso: null });
    render(<ModeloContratoCard />);

    fireEvent.click(screen.getByTestId('modelo-voltar-padrao'));
    fireEvent.click(screen.getByTestId('modelo-confirmar-ativacao'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/modelos-contrato/padrao/ativar'));
  });
});
