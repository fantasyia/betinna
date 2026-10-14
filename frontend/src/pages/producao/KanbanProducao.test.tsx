import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** Kanban da produção (Léo, 14/10): as 7 etapas e o "mover" de OP. */

const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { patch: (...a: unknown[]) => apiPatch(...a) },
  apiErrorMessage: (e: unknown) => String(e),
}));
const toastError = vi.fn();
vi.mock('@/components/toast', () => ({ useToast: () => ({ error: toastError, success: vi.fn() }) }));

import { KanbanProducao, colunasDoKanban, type OpDoKanban } from './KanbanProducao';

afterEach(() => {
  cleanup();
  apiPatch.mockReset();
  toastError.mockReset();
});

const op = (id: string, etapa: string | undefined, extra: Partial<OpDoKanban> = {}): OpDoKanban => ({
  id,
  numero: id.toUpperCase(),
  status: 'RASCUNHO',
  etapa,
  modelo: { nome: 'Bermuda' },
  faccao: null,
  prazo: null,
  planejada: 100,
  cortada: 0,
  aReceber: 0,
  atrasada: false,
  ...extra,
});

describe('colunasDoKanban', () => {
  it('as 7 etapas do Léo, na ordem; sem etapa = rascunho; cancelada fora', () => {
    const c = colunasDoKanban([
      op('a', 'COSTURA'),
      op('b', undefined),
      op('c', 'CORTE', { status: 'CANCELADA' }),
    ]);
    expect(c.map((x) => x.titulo)).toEqual([
      'Rascunho',
      'Impressão Risco',
      'Corte',
      'Costura',
      'Acabamento',
      'Conferência',
      'Concluído',
    ]);
    expect(c[0].ops.map((o) => o.id)).toEqual(['b']);
    expect(c[3].ops.map((o) => o.id)).toEqual(['a']);
    expect(c.flatMap((x) => x.ops).some((o) => o.id === 'c')).toBe(false);
  });

  it('na coluna: atrasada primeiro, depois o prazo mais curto, sem prazo no fim', () => {
    const c = colunasDoKanban([
      op('sem', 'COSTURA'),
      op('longe', 'COSTURA', { prazo: '2026-12-01' }),
      op('perto', 'COSTURA', { prazo: '2026-10-20' }),
      op('atrasada', 'COSTURA', { prazo: '2026-11-30', atrasada: true }),
    ]);
    expect(c[3].ops.map((o) => o.id)).toEqual(['atrasada', 'perto', 'longe', 'sem']);
  });
});

describe('<KanbanProducao>', () => {
  it('"Mover para" muda a etapa na API e o card já aparece na coluna nova', async () => {
    let resolver: (v: unknown) => void = () => undefined;
    apiPatch.mockImplementation(() => new Promise((r) => (resolver = r)));
    const onMudou = vi.fn();
    render(
      <MemoryRouter>
        <KanbanProducao ops={[op('op1', 'CORTE')]} onMudou={onMudou} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('kanban-mover-op1'), { target: { value: 'COSTURA' } });
    expect(apiPatch).toHaveBeenCalledWith('/erp/ops/op1/etapa', { etapa: 'COSTURA' });
    // Otimista: antes da resposta já está em Costura.
    expect(screen.getByTestId('kanban-coluna-COSTURA').textContent).toContain('OP1');
    resolver({});
    await waitFor(() => expect(onMudou).toHaveBeenCalled());
  });

  it('API recusou: avisa e o card volta pra etapa de antes', async () => {
    apiPatch.mockRejectedValue(new Error('cancelada'));
    render(
      <MemoryRouter>
        <KanbanProducao ops={[op('op1', 'CORTE')]} onMudou={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('kanban-mover-op1'), { target: { value: 'COSTURA' } });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByTestId('kanban-coluna-CORTE').textContent).toContain('OP1');
  });
});
