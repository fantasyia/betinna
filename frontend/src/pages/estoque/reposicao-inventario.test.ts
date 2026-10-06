import { describe, expect, it } from 'vitest';
import { diferencas } from './InventarioPage';
import { porModelo } from './ReposicaoPage';

describe('inventário', () => {
  it('só o que foi preenchido conta; a diferença é contra o físico', () => {
    const d = diferencas({ a: '8', b: '', c: '4' }, new Map([['a', 10], ['c', 4]]));
    expect(d).toEqual([
      { produtoId: 'a', contado: 8, diferenca: -2 },
      { produtoId: 'c', contado: 4, diferenca: 0 },
    ]);
  });
});

describe('reposição', () => {
  it('agrupa por modelo mantendo a ordem de maior falta', () => {
    const r = (id: string, modelo: string, repor: number) =>
      ({ produtoId: id, modelo: { id: modelo, nome: modelo, ordem: 0 }, repor }) as never;
    const g = porModelo([r('1', 'A', 9), r('2', 'B', 5), r('3', 'A', 2)]);
    expect(g.map((x) => [x.modelo.id, x.itens.map((i) => i.produtoId)])).toEqual([
      ['A', ['1', '3']],
      ['B', ['2']],
    ]);
  });
});
