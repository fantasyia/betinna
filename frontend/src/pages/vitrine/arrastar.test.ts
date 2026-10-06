import { describe, expect, it } from 'vitest';
import { moverItem } from './arrastar';

describe('moverItem', () => {
  it('move pra frente e pra trás', () => {
    expect(moverItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moverItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('posição inválida ou igual devolve cópia intacta', () => {
    const l = ['a', 'b'];
    expect(moverItem(l, 0, 0)).toEqual(['a', 'b']);
    expect(moverItem(l, 0, 5)).toEqual(['a', 'b']);
    expect(moverItem(l, 0, 0)).not.toBe(l);
  });
});
