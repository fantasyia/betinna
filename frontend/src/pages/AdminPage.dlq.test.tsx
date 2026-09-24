import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Dead-letter na tela (24/09): o backend manda o que interessa DENTRO de
 * `data` (DeadLetterService.list). A tela lia campos na raiz que nunca
 * existiram e mostrava toda linha como "—". Este teste usa o formato real.
 */

let resposta: unknown = [];
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: resposta, loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const { DeadLetterSection } = await import('./AdminPage');

afterEach(() => cleanup());

describe('DeadLetterSection', () => {
  it('mostra fila, nome do job e motivo a partir de `data` — o formato que a API devolve', () => {
    resposta = [
      {
        id: '42',
        addedAt: Date.parse('2026-09-24T07:00:00Z'),
        data: {
          originalQueue: 'fluxo-execucao',
          originalJobId: 'exec-9',
          originalJobName: 'executar-passo',
          originalData: { empresaId: 'emp-1' },
          error: 'Timeout falando com a Evolution',
          failedAt: '2026-09-24T07:00:00Z',
        },
      },
    ];
    render(<DeadLetterSection />);
    expect(screen.getByTestId('dlq-job').textContent).toBe('executar-passo');
    expect(screen.getByTestId('dlq-fila').textContent).toBe('fluxo-execucao');
    expect(screen.getByTestId('dlq-motivo').textContent).toBe('Timeout falando com a Evolution');
  });
});
