import { describe, expect, it } from 'vitest';
import {
  conta,
  lerNumero,
  pedidoMinimoEmPecas,
  precoParaLucro,
  quantidades,
  type Simulacao,
} from './calculo';

/**
 * Números do exemplo da especificação (§5, critério 3): custo 9,70; imposto +
 * taxa 8%; anúncio 50; embalagem 3; faixas 17,99 / 15,99 / 14,99; mínimo
 * "50 peças OU R$ 600"; Volume 200, Atacadão 1.000. Os esperados saíram da
 * calculadora de referência rodada com os mesmos números.
 */
const exemplo: Simulacao = {
  custo: 9.7,
  impostoPct: 6,
  taxaPct: 2,
  anuncioPorPedido: 50,
  embalagemPorPedido: 3,
  precos: { entrada: 17.99, volume: 15.99, atacadao: 14.99 },
  sugerido: 39.9,
  faixas: { minimoVolume: 200, minimoAtacadao: 1000 },
  minimo: { valorMin: 600, quantidadeMin: 50, modo: 'OU' },
};

describe('bate com a calculadora de referência', () => {
  it('pedido mínimo = 34 peças (R$ 600 ÷ 17,99 chega antes das 50)', () => {
    expect(pedidoMinimoEmPecas(exemplo)).toBe(34);
    expect(quantidades(exemplo, 120)).toEqual({ fixas: [34, 200, 1000], todas: [34, 120, 200, 1000], minimo: 34 });
  });

  it.each([
    [34, 'entrada', 611.66, 431.7328, 179.9272, 0.29416],
    [200, 'volume', 3198, 2248.84, 949.16, 0.2968],
    [1000, 'atacadao', 14990, 10952.2, 4037.8, 0.26937],
    [120, 'entrada', 2158.8, 1389.704, 769.096, 0.35626],
  ])('%i peças', (q, faixa, receita, custos, lucro, margem) => {
    const c = conta(q, exemplo);
    expect(c.faixa).toBe(faixa);
    expect(c.receita).toBeCloseTo(receita, 2);
    expect(c.custos).toBeCloseTo(custos, 2);
    expect(c.lucro).toBeCloseTo(lucro, 2);
    expect(c.margem).toBeCloseTo(margem, 4);
    expect(c.fecha).toBe(true);
  });

  it('quanto cobrar: R$ 3 por peça num pedido de 500 → R$ 13,92', () => {
    expect(precoParaLucro(3, 500, exemplo)).toBeCloseTo(13.9196, 3);
  });
});

describe('regras', () => {
  it('lojista lucra = revenda sugerida − preço da faixa', () => {
    expect(conta(200, exemplo).lojista).toEqual({ porPeca: expect.closeTo(23.91, 2), pct: 150 });
  });
  it('abaixo do mínimo não fecha; regra E exige os dois', () => {
    expect(conta(20, exemplo).fecha).toBe(false);
    const e = { ...exemplo, minimo: { valorMin: 600, quantidadeMin: 50, modo: 'E' as const } };
    expect(pedidoMinimoEmPecas(e)).toBe(50);
    expect(conta(40, e).fecha).toBe(false);
  });
  it('faixa sem preço usa a de baixo (igual à vitrine); nenhuma = sem preço', () => {
    const s = { ...exemplo, precos: { entrada: 17.99, volume: null, atacadao: null } };
    expect(conta(1000, s).preco).toBe(17.99);
    expect(conta(10, { ...exemplo, precos: { entrada: null, volume: 15, atacadao: null } }).preco).toBeNull();
  });
  it('sem pedido mínimo configurado: começa em 1 peça', () => {
    expect(quantidades({ ...exemplo, minimo: null }).fixas).toEqual([1, 200, 1000]);
  });
  it('imposto + taxa ≥ 100%: não há preço que dê lucro', () => {
    expect(precoParaLucro(3, 500, { ...exemplo, impostoPct: 90, taxaPct: 10 })).toBeNull();
  });
  it('lê número digitado em pt-BR', () => {
    expect(lerNumero('9,70')).toBe(9.7);
    expect(lerNumero('1.234,5')).toBe(1234.5);
    expect(lerNumero('')).toBeNull();
  });
});
