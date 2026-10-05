import { describe, expect, it } from 'vitest';
import { dimensoesAlvo } from './imagem';

describe('dimensoesAlvo', () => {
  it('reduz foto grande pra largura alvo mantendo a proporção', () => {
    expect(dimensoesAlvo(4000, 3000, 1080)).toEqual({ largura: 1080, altura: 810 });
    expect(dimensoesAlvo(3024, 4032, 1080)).toEqual({ largura: 1080, altura: 1440 });
  });

  it('não amplia foto que já é menor que o alvo', () => {
    expect(dimensoesAlvo(800, 1200, 1080)).toEqual({ largura: 800, altura: 1200 });
  });

  it('dimensão inválida não vira divisão por zero', () => {
    expect(dimensoesAlvo(0, 100, 1080)).toEqual({ largura: 0, altura: 0 });
  });
});
