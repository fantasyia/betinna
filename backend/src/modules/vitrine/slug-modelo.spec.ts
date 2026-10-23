import { describe, expect, it } from 'vitest';
import { slugDoNome, slugLivre } from './slug-modelo';

describe('slug do produto (/p/<slug>, 23/10)', () => {
  it('sem acento, minúsculo, hífen', () => {
    expect(slugDoNome('Blusão Moletom Canguru com Capuz')).toBe('blusao-moletom-canguru-com-capuz');
    expect(slugDoNome('Calça Tactel com Zíper nos bolsos')).toBe(
      'calca-tactel-com-ziper-nos-bolsos',
    );
    expect(slugDoNome('  ***  ')).toBe('produto');
  });

  it('repetido na empresa ganha -2, -3', () => {
    const usados = new Set(['camiseta-uv']);
    expect(slugLivre('Camiseta UV', usados)).toBe('camiseta-uv-2');
    usados.add('camiseta-uv-2');
    expect(slugLivre('Camiseta UV', usados)).toBe('camiseta-uv-3');
  });
});
