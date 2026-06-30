import { describe, it, expect } from 'vitest';
import { matchPalavraChave } from './match-palavra-chave.util';

describe('matchPalavraChave', () => {
  it('sem palavras configuradas → não casa (não vira spam)', () => {
    expect(matchPalavraChave('qualquer coisa', {})).toBe(false);
    expect(matchPalavraChave('qualquer coisa', { palavrasChave: [] })).toBe(false);
    expect(matchPalavraChave('qualquer coisa', { palavrasChave: ['  '] })).toBe(false);
  });

  it('texto vazio nunca casa', () => {
    expect(matchPalavraChave('', { palavrasChave: ['oi'] })).toBe(false);
    expect(matchPalavraChave('   ', { palavrasChave: ['oi'] })).toBe(false);
  });

  it('modo "qualquer" (default) casa se ≥1 palavra aparece como substring', () => {
    const cfg = { palavrasChave: ['cancelar', 'reembolso'] };
    expect(matchPalavraChave('quero cancelar meu pedido', cfg)).toBe(true);
    expect(matchPalavraChave('pedir reembolso por favor', cfg)).toBe(true);
    expect(matchPalavraChave('quero comprar mais', cfg)).toBe(false);
  });

  it('modo "todas" exige todas as palavras presentes', () => {
    const cfg = { palavrasChave: ['nota', 'fiscal'], modo: 'todas' as const };
    expect(matchPalavraChave('preciso da nota fiscal', cfg)).toBe(true);
    expect(matchPalavraChave('preciso da nota', cfg)).toBe(false);
  });

  it('modo "exata" casa só quando o texto inteiro == palavra', () => {
    const cfg = { palavrasChave: ['parar', 'sair'], modo: 'exata' as const };
    expect(matchPalavraChave('parar', cfg)).toBe(true);
    expect(matchPalavraChave('  Parar  ', cfg)).toBe(true); // trim + case
    expect(matchPalavraChave('quero parar', cfg)).toBe(false);
  });

  it('case-insensitive por default; caseSensitive respeita maiúsculas', () => {
    expect(matchPalavraChave('CANCELAR AGORA', { palavrasChave: ['cancelar'] })).toBe(true);
    expect(
      matchPalavraChave('CANCELAR AGORA', { palavrasChave: ['cancelar'], caseSensitive: true }),
    ).toBe(false);
  });

  it('normaliza acentos por default; pode desligar', () => {
    expect(matchPalavraChave('quero a 2a via', { palavrasChave: ['2ª via'] })).toBe(true);
    expect(matchPalavraChave('comprei açaí', { palavrasChave: ['acai'] })).toBe(true);
    expect(
      matchPalavraChave('comprei açaí', { palavrasChave: ['acai'], normalizarAcentos: false }),
    ).toBe(false);
  });
});
