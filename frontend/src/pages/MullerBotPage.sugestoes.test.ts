import { describe, it, expect } from 'vitest';
import { montarSugestoes } from './MullerBotPage';

/**
 * Sugestões do assistente de catálogo (pedido do Léo, 24/08).
 *
 * As antigas eram fixas e vinham do primeiro cliente: "linha de molhos",
 * "abaixo de R$ 50", "embalagens grandes". Numa empresa de proteção elétrica
 * elas sugeriam perguntar por molho de tomate — e o assistente é a primeira
 * coisa que alguém abre pra entender o que o bot faz.
 */
describe('montarSugestoes', () => {
  it('usa marca, linha e categoria REAIS do catálogo', () => {
    const s = montarSugestoes({
      marcas: ['Somatec'],
      linhas: ['Master Block'],
      categorias: ['Proteção elétrica'],
    });

    expect(s[0]).toContain('Somatec');
    expect(s[1]).toContain('Master Block');
    expect(s[2]).toContain('Proteção elétrica');
  });

  it('catálogo vazio: cai nas neutras, sem inventar produto nem preço', () => {
    const s = montarSugestoes(undefined);

    expect(s).toHaveLength(4);
    // O que não pode voltar: domínio do primeiro cliente e faixa de preço.
    expect(s.join(' ')).not.toMatch(/molho|R\$|embalage/i);
  });

  it('catálogo parcial completa até 4 sem deixar buraco', () => {
    const s = montarSugestoes({ marcas: ['Somatec'], linhas: [], categorias: [] });

    expect(s).toHaveLength(4);
    expect(s[0]).toContain('Somatec');
    // As demais são neutras — e nenhuma vem vazia.
    expect(s.every((q) => q.trim().length > 0)).toBe(true);
  });

  it('nunca passa de 4 sugestões', () => {
    const s = montarSugestoes({
      marcas: ['A', 'B'],
      linhas: ['C'],
      categorias: ['D'],
    });

    expect(s).toHaveLength(4);
  });
});
