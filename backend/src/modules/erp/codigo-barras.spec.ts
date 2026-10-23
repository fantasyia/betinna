import { describe, expect, it } from 'vitest';
import { barras, modulosCode128, modulosEan13 } from './codigo-barras';
import { desenharPdf, type PecaEtiqueta } from './etiquetas.service';

describe('EAN-13', () => {
  it('95 módulos, com as guardas nas pontas e no meio', () => {
    const m = modulosEan13('7908700027606');
    expect(m).toHaveLength(95);
    expect(m.slice(0, 3)).toBe('101');
    expect(m.slice(45, 50)).toBe('01010');
    expect(m.slice(-3)).toBe('101');
  });

  it('confere com a codificação de referência (4006381333931)', () => {
    // Lado esquerdo do 4006381333931: paridade "LGLLGG" do dígito 4.
    expect(modulosEan13('4006381333931').slice(3, 45)).toBe(
      '0001101' + '0100111' + '0101111' + '0111101' + '0001001' + '0110011',
    );
  });

  it('recusa EAN com tamanho errado', () => {
    expect(() => modulosEan13('123')).toThrow(/inválido/);
  });
});

describe('Code 128-B', () => {
  it('cada símbolo tem 11 módulos (stop 13) e o total bate', () => {
    const texto = 'BERMUDA-M';
    const m = modulosCode128(texto);
    // start + dados + checksum = 11 cada; stop = 13
    expect(m).toHaveLength(11 * (texto.length + 2) + 13);
    expect(m.startsWith('11010010000')).toBe(true); // Start B
    expect(m.endsWith('1100011101011')).toBe(true); // Stop
  });

  it('caractere fora do conjunto B estoura', () => {
    expect(() => modulosCode128('ç')).toThrow(/Code 128/);
  });
});

describe('barras', () => {
  it('agrupa módulos pretos em retângulos', () => {
    expect(barras('0110111')).toEqual([
      [1, 2],
      [4, 3],
    ]);
  });
});

describe('PDF das etiquetas', () => {
  const peca: PecaEtiqueta = {
    produtoId: 'p1',
    modelo: 'Bermuda Moletom Summer',
    cor: 'Preto',
    linha: 'Regular',
    tamanho: 'M',
    sku: '1113001527',
    ean: '7908700027606',
  };
  it('40×80: uma página por etiqueta, no tamanho exato', async () => {
    const pdf = await desenharPdf([peca, peca, { ...peca, ean: null }], '40x80', '22/10/2026');
    const txt = pdf.toString('latin1');
    expect(txt.match(/\/Type \/Page\b/g)).toHaveLength(3);
    expect(txt).toContain('/MediaBox [0 0 113.38');
  });

  it('50×30 em 2 colunas: 3 etiquetas = 2 fileiras', async () => {
    const pdf = await desenharPdf([peca, peca, peca], '50x30', '22/10/2026');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  });
});
