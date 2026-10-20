import { describe, expect, it } from 'vitest';
import { digitoEan, eanValido, proximosEansInternos, skuSugerido } from './codigos-produto';

describe('EAN-13', () => {
  it('dígito verificador confere com EAN real', () => {
    // 7891000315507 (EAN real de mercado)
    expect(digitoEan('789100031550')).toBe(7);
    expect(eanValido('7891000315507')).toBe(true);
    expect(eanValido('7891000315508')).toBe(false);
    expect(eanValido('789100031550')).toBe(false);
  });

  it('faixa interna começa com 2, continua do maior usado e não reaproveita buraco', () => {
    const [a, b] = proximosEansInternos([], 2);
    expect(a!.startsWith('2')).toBe(true);
    expect(eanValido(a!) && eanValido(b!)).toBe(true);
    expect(a!.slice(0, 12)).toBe('200000000001');
    const depois = proximosEansInternos(
      ['200000000005' + digitoEan('200000000005'), '7891000315507'],
      1,
    );
    expect(depois[0]!.slice(0, 12)).toBe('200000000006');
  });
});

describe('skuSugerido', () => {
  it('modelo-cor-linha-tamanho, sem acento, sem repetir', () => {
    const usados = new Set<string>();
    const p = {
      modelo: 'Bermuda Moletom Summer',
      cor: 'Verde-Militar',
      linha: 'Plus Size',
      tamanho: 'G1',
    };
    expect(skuSugerido(p, usados)).toBe('BERMUDA-MOLETOM-SUMMER-VERDE-MILITAR-PLUS-SIZE-G1');
    expect(skuSugerido(p, usados)).toBe('BERMUDA-MOLETOM-SUMMER-VERDE-MILITAR-PLUS-SIZE-G1-2');
    expect(skuSugerido({ ...p, cor: 'Açaí' }, usados)).toContain('-ACAI-');
  });
});
