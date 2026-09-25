import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * "Lançar comissões no ERP" (Léo, 25/09): no dia do fechamento, um botão cria
 * as contas a pagar do mês — pedido a pedido, 1 por pessoa.
 */

const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a), get: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}));

const { LancarErpModal } = await import('./ComissoesPage');

afterEach(() => {
  cleanup();
  apiPost.mockReset();
});

describe('LancarErpModal', () => {
  it('lança o mês escolhido e mostra o que foi criado e quem ficou sem contato', async () => {
    apiPost.mockResolvedValue({
      provisionadas: 0,
      semContatoNoErp: [],
      erros: 0,
      originacao: { valor: 0, provisionada: false },
      porPedido: {
        pedidos: 3,
        criadas: 5,
        atualizadas: 0,
        semContato: ['Anna'],
        paraApagar: [],
        erros: 0,
      },
    });
    render(<LancarErpModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Mês/), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText(/Ano/), { target: { value: '2026' } });
    fireEvent.click(screen.getByTestId('lancar-erp-confirm'));

    await waitFor(() => expect(screen.getByTestId('lancar-erp-resultado')).toBeTruthy());
    expect(apiPost).toHaveBeenCalledWith('/comissoes/provisionar-erp', { mes: 9, ano: 2026 });
    const txt = screen.getByTestId('lancar-erp-resultado').textContent ?? '';
    expect(txt).toContain('5 conta(s) a pagar criada(s) em 3 pedido(s)');
    expect(txt).toContain('Sem contato no ERP (não lançado): Anna');
  });
});
