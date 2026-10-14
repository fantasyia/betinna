import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KanbanProducao, colunasDoKanban, type OpDoKanban } from './KanbanProducao';

/** Kanban da produção (Léo, 14/10): quais OPs estão em cada etapa. */

afterEach(cleanup);

const op = (id: string, status: string, extra: Partial<OpDoKanban> = {}): OpDoKanban => ({
  id,
  numero: id.toUpperCase(),
  status,
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
  it('uma coluna por etapa, na ordem da fábrica; cancelada fica fora', () => {
    const c = colunasDoKanban([op('a', 'CORTADA'), op('b', 'RASCUNHO'), op('c', 'CANCELADA')]);
    expect(c.map((x) => x.status)).toEqual(['RASCUNHO', 'CORTADA', 'NA_FACCAO', 'RECEBENDO', 'FECHADA']);
    expect(c[0].ops.map((o) => o.id)).toEqual(['b']);
    expect(c.flatMap((x) => x.ops).some((o) => o.id === 'c')).toBe(false);
  });

  it('na coluna: atrasada primeiro, depois o prazo mais curto, sem prazo no fim', () => {
    const c = colunasDoKanban([
      op('sem', 'NA_FACCAO'),
      op('longe', 'NA_FACCAO', { prazo: '2026-12-01' }),
      op('perto', 'NA_FACCAO', { prazo: '2026-10-20' }),
      op('atrasada', 'NA_FACCAO', { prazo: '2026-11-30', atrasada: true }),
    ]);
    expect(c[2].ops.map((o) => o.id)).toEqual(['atrasada', 'perto', 'longe', 'sem']);
  });
});

describe('<KanbanProducao>', () => {
  it('card leva pra OP e mostra a contagem da coluna', () => {
    render(
      <MemoryRouter>
        <KanbanProducao ops={[op('op1', 'RASCUNHO'), op('op2', 'RASCUNHO')]} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('kanban-coluna-RASCUNHO').textContent).toContain('2');
    expect(screen.getByTestId('kanban-op-op1').getAttribute('href')).toBe('/producao/op1');
    expect(screen.getByTestId('kanban-coluna-FECHADA').textContent).toContain('Nenhuma OP');
  });
});
