import { describe, expect, it } from 'vitest';
import {
  digitoEan,
  eanUsadosAte,
  eanValido,
  prefixoGs1,
  proximosEans,
  proximosEansInternos,
  skuNumerico,
} from './codigos-produto';

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

describe('prefixo GS1 da empresa (22/10)', () => {
  it('continua do maior EAN do prefixo, sem repetir, ignorando os de outro prefixo', () => {
    const usados = ['7908700027323', '7908700027590', '2000000000015'];
    const [a, b] = proximosEans(usados, 2, '7908700');
    expect(a!.slice(0, 12)).toBe('790870002760');
    expect(b!.slice(0, 12)).toBe('790870002761');
    expect(eanValido(a!) && eanValido(b!)).toBe(true);
  });

  it('lê o prefixo da config; inválido vira null (cai na faixa interna)', () => {
    expect(prefixoGs1({ codigos: { prefixoGs1: '7908700' } })).toBe('7908700');
    expect(prefixoGs1({ codigos: { prefixoGs1: '79A' } })).toBeNull();
    expect(prefixoGs1(null)).toBeNull();
  });

  it('o maior EAN usado FORA do app (planilha) também conta — o gerador começa depois', () => {
    const fora = eanUsadosAte({ codigos: { eanUsadosAte: '7908700027590' } });
    expect(fora).toBe('7908700027590');
    const [a] = proximosEans(['7908700026258', fora!], 1, '7908700');
    expect(a!.slice(0, 12)).toBe('790870002760');
    expect(eanUsadosAte({ codigos: { eanUsadosAte: '7908700027591' } })).toBeNull(); // verificador errado
  });

  it('faixa esgotada estoura em vez de dar a volta', () => {
    expect(() =>
      proximosEans(['7908700999990'.slice(0, 12) + digitoEan('790870099999')], 1, '7908700'),
    ).toThrow(/esgotada/);
  });
});

describe('skuNumerico', () => {
  it('continua a série 1113, sem repetir e sem usar texto', () => {
    const usados = new Set(['1113001500', '1005', 'MOLETOM-PRETO-M']);
    expect(skuNumerico(usados)).toBe('1113001501');
    expect(skuNumerico(usados)).toBe('1113001502');
  });

  it('sem nada na série, começa depois do maior da Ribelt', () => {
    expect(skuNumerico(new Set())).toBe('1113001421');
  });
});
