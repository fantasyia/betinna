import { describe, expect, it } from 'vitest';
import { melhorPonto, posicaoDoFundo } from './amostra';

/** Foto 12×12: metade esquerda pele (#c89070), direita tecido bege (#9e9176). */
function foto(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(12 * 12 * 4);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const i = (y * 12 + x) * 4;
      const [r, g, b] = x < 6 ? [0xc8, 0x90, 0x70] : [0x9e, 0x91, 0x76];
      px.set([r, g, b, 255], i);
    }
  }
  return px;
}

describe('bolinha da cor (recorte da foto)', () => {
  it('acha o tecido da cor cadastrada, não a mão do lado', () => {
    const p = melhorPonto(foto(), 12, 12, '#9E9176', 2);
    expect(p?.fx).toBeGreaterThan(0.5);
  });

  it('prefere o miolo da peça à borda encostada no fundo', () => {
    // 16×16: fundo azul-petróleo, peça cinza só em x 4–11 × y 4–11
    const px = new Uint8ClampedArray(16 * 16 * 4);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dentro = x >= 4 && x < 12 && y >= 4 && y < 12;
        px.set(dentro ? [0x82, 0x85, 0x87, 255] : [0x1f, 0x4e, 0x5a, 255], (y * 16 + x) * 4);
      }
    }
    expect(melhorPonto(px, 16, 16, '#828587', 4)).toEqual({ fx: 0.375, fy: 0.375 });
  });

  it('hex inválido → sem escolha (cai no miolo)', () => {
    expect(melhorPonto(foto(), 12, 12, 'bege')).toBeNull();
  });

  it('centro da foto fica no centro; cantos não passam de 0–100%', () => {
    expect(posicaoDoFundo({ fx: 0.5, fy: 0.5, aspecto: 0.75 })).toEqual({ x: 50, y: 50 });
    expect(posicaoDoFundo({ fx: 0, fy: 1, aspecto: 0.75 })).toEqual({ x: 0, y: 100 });
  });
});
