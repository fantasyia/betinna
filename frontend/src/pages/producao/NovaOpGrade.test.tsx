import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

/** Nova OP pela grade do risco (Léo, 14/10): linha → grade → cores × grades. */

const apiPost = vi.fn();
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useLocation: () => ({ state: null }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a), get: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/hooks/usePermission', () => ({ useRole: () => 'DIRECTOR' }));

const v = (produtoId: string, linha: string, lo: number, tamanho: string, to: number, cor: string, co: number) => ({
  produtoId,
  ativo: true,
  modelo: { id: 'm-1', nome: 'Bermuda', ordem: 0 },
  cor: { nome: cor, hex: '#000000', ordem: co },
  linha: { nome: linha, ordem: lo },
  tamanho: { nome: tamanho, ordem: to },
  fisico: 0,
  reservado: 0,
  disponivel: 0,
});
const variacoes = [
  v('pre-m', 'Regular', 0, 'M', 1, 'Preto', 0),
  v('pre-g', 'Regular', 0, 'G', 2, 'Preto', 0),
  v('pre-gg', 'Regular', 0, 'GG', 3, 'Preto', 0),
  v('bege-m', 'Regular', 0, 'M', 1, 'Bege', 1),
  v('bege-g', 'Regular', 0, 'G', 2, 'Bege', 1),
  v('bege-gg', 'Regular', 0, 'GG', 3, 'Bege', 1),
];
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => ({
    data: path === '/erp/estoque/saldos' ? variacoes : [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { NovaOpDialog } from './ProducaoPage';

afterEach(() => {
  cleanup();
  apiPost.mockReset();
});

describe('Nova OP — pela grade do risco', () => {
  it('2M 2G 1GG · Preto × 20 · Bege × 10 → a OP com as peças e a grade junto', async () => {
    apiPost.mockImplementation(async (rota: string) =>
      rota === '/erp/ops' ? { id: 'op-9', numero: 'OP-0009' } : null,
    );
    const onCriou = vi.fn();
    render(<NovaOpDialog inicial={null} onClose={vi.fn()} onCriou={onCriou} />);

    fireEvent.change(screen.getByTestId('op-risco-M'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('op-risco-G'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('op-risco-GG'), { target: { value: '1' } });
    expect(screen.getByTestId('op-pela-grade').textContent).toContain('5 peças por grade');

    fireEvent.change(screen.getByTestId('op-risco-add-cor'), { target: { value: 'Preto' } });
    fireEvent.change(screen.getByTestId('op-risco-grades-Preto'), { target: { value: '20' } });
    fireEvent.change(screen.getByTestId('op-risco-add-cor'), { target: { value: 'Bege' } });
    fireEvent.change(screen.getByTestId('op-risco-grades-Bege'), { target: { value: '10' } });

    // Prévia: total da OP = 150 peças.
    expect(screen.getByTestId('op-risco-previa').textContent).toContain('150');

    fireEvent.click(screen.getByTestId('op-gerar'));
    await waitFor(() => expect(onCriou).toHaveBeenCalledWith('op-9'));
    const corpo = apiPost.mock.calls.find((c) => c[0] === '/erp/ops')?.[1] as {
      itens: Array<{ produtoId: string; quantidade: number }>;
      gradeRisco: unknown;
    };
    expect(Object.fromEntries(corpo.itens.map((i) => [i.produtoId, i.quantidade]))).toEqual({
      'pre-m': 40,
      'pre-g': 40,
      'pre-gg': 20,
      'bege-m': 20,
      'bege-g': 20,
      'bege-gg': 10,
    });
    expect(corpo.gradeRisco).toEqual({
      linha: 'Regular',
      composicao: [
        { tamanho: 'M', quantidade: 2 },
        { tamanho: 'G', quantidade: 2 },
        { tamanho: 'GG', quantidade: 1 },
      ],
      cores: [
        { cor: 'Preto', grades: 20 },
        { cor: 'Bege', grades: 10 },
      ],
    });
  });

  it('"Peça por peça" segue existindo e não manda grade do risco', async () => {
    apiPost.mockResolvedValue({ id: 'op-9', numero: 'OP-0009' });
    render(<NovaOpDialog inicial={null} onClose={vi.fn()} onCriou={vi.fn()} />);
    fireEvent.click(screen.getByText('Peça por peça'));
    expect(screen.queryByTestId('op-pela-grade')).toBeNull();
    expect(screen.getByTestId('op-grade')).toBeTruthy();
  });
});
