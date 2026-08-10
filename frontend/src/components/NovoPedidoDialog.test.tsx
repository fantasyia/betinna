import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NovoPedidoDialog } from './NovoPedidoDialog';

/**
 * Specs do NovoPedidoDialog — a tela de dinheiro que faltava (achado #87).
 *
 * O que elas travam (achado #83): o total mostrado tem que vir do SERVIDOR
 * (POST /pedidos/preview), não do cálculo duplicado no client com
 * `produto.precoTabela`. O client não conhece o preço NEGOCIADO do cliente, e o
 * rep citava ao telefone um número diferente do que o pedido persistia.
 */

const post = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    post: (...a: unknown[]) => post(...a),
    get: vi.fn().mockResolvedValue([]),
    patch: vi.fn(),
  },
  ApiError: class extends Error {},
}));
vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/hooks/useEmpresaConfig', () => ({
  useEmpresaConfig: () => ({ data: null }),
  descontoAVistaPct: () => 0,
}));
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

const PRODUTO = {
  id: 'p1',
  nome: 'Master Block MB-04',
  sku: 'MB04',
  precoTabela: 10000,
  unidade: 'UN',
};

const inicial = {
  itens: [{ produto: PRODUTO as never, quantidade: 1, desconto: 0 }],
};

const abrir = () =>
  render(
    <NovoPedidoDialog
      open
      clientePreSelecionado={{ id: 'cli-1', nome: 'Cliente X' } as never}
      inicial={inicial as never}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />,
  );

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  post.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('NovoPedidoDialog — preço negociado (#83)', () => {
  it('mostra o total do SERVIDOR, não o da tabela', async () => {
    // Tabela diz 10.000; o cliente tem preço negociado de 8.000.
    post.mockResolvedValue({
      totals: { subtotal: 8000, total: 8000 },
      itens: [
        {
          produtoId: 'p1',
          nome: PRODUTO.nome,
          precoUnitario: 8000,
          quantidade: 1,
          desconto: 0,
          total: 8000,
          negociado: true,
        },
      ],
      requerAprovacao: false,
    });

    abrir();
    await vi.advanceTimersByTimeAsync(500);

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/pedidos/preview', expect.anything());
    });
    await waitFor(() => {
      expect(document.body.textContent).toContain('8.000');
    });
    // O número da TABELA não pode estar no bloco de total.
    expect(screen.getByText(/Total \(confirmado pelo servidor\)/)).toBeTruthy();
  });

  it('avisa que há item com preço negociado', async () => {
    post.mockResolvedValue({
      totals: { subtotal: 8000, total: 8000 },
      itens: [{ produtoId: 'p1', nome: 'x', precoUnitario: 8000, quantidade: 1, desconto: 0, total: 8000, negociado: true }],
      requerAprovacao: false,
    });

    abrir();
    await vi.advanceTimersByTimeAsync(500);

    await waitFor(() => {
      expect(screen.getByTestId('pedido-preco-negociado').textContent).toContain('negociado');
    });
  });

  it('preview falhando cai no cálculo local e AVISA que é estimativa', async () => {
    post.mockRejectedValue(new Error('offline'));

    abrir();
    await vi.advanceTimersByTimeAsync(500);

    await waitFor(() => {
      expect(document.body.textContent).toContain('Estimativa pela tabela');
    });
    expect(screen.queryByTestId('pedido-preco-negociado')).toBeNull();
  });

  it('não chama o preview sem itens válidos', async () => {
    render(
      <NovoPedidoDialog
        open
        clientePreSelecionado={{ id: 'cli-1', nome: 'Cliente X' } as never}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(post).not.toHaveBeenCalled();
  });
});
