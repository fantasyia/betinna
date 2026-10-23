import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/** Etiquetas (20/10): grade da OP pré-preenchida, formato e o pedido do PDF. */

const PECAS = [
  { produtoId: 'p-m', modelo: 'Bermuda', cor: 'Preto', linha: 'Regular', tamanho: 'M', sku: '111', ean: '7908700027606' },
  { produtoId: 'p-g', modelo: 'Bermuda', cor: 'Preto', linha: 'Regular', tamanho: 'G', sku: '112', ean: null },
  { produtoId: 'p-x', modelo: 'Calça', cor: 'Bege', linha: 'Regular', tamanho: 'P', sku: '113', ean: null },
];
const apiPost = vi.fn().mockResolvedValue({ filename: 'e.pdf', base64: '', etiquetas: 15 });
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: PECAS, loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a) },
  apiErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { EtiquetasDialog } from './EtiquetasDialog';

afterEach(() => cleanup());

describe('EtiquetasDialog', () => {
  it('da OP: mostra só as peças da grade, já com as quantidades', () => {
    render(<EtiquetasDialog open onClose={vi.fn()} inicial={{ 'p-m': 10, 'p-g': 5 }} />);
    expect((screen.getByTestId('etq-qtd-p-m') as HTMLInputElement).value).toBe('10');
    expect(screen.queryByTestId('etq-qtd-p-x')).toBeNull();
    expect(screen.getByTestId('etq-total').textContent).toContain('15 etiquetas');
  });

  it('pede o PDF no formato escolhido, só com as peças que têm quantidade', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    render(<EtiquetasDialog open onClose={vi.fn()} inicial={{ 'p-m': 10, 'p-g': 5 }} />);
    fireEvent.click(screen.getByTestId('etq-formato-40x80'));
    fireEvent.change(screen.getByTestId('etq-qtd-p-g'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('etq-gerar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/erp/etiquetas', {
      formato: '40x80',
      itens: [{ produtoId: 'p-m', quantidade: 10 }],
    });
  });
});
