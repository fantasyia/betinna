import { describe, it, expect } from 'vitest';
import {
  formatMoeda,
  formatMoedaCompacta,
  formatNumero,
  formatNumeroCompacto,
  formatPercent,
  maskDinheiro,
  parseDinheiro,
  isValidCNPJ,
  stripMask,
} from './masks';

/**
 * Testes das funções de DINHEIRO/valor do frontend. São o que, se quebrar,
 * mostra valor errado pro usuário (custo de confiança/dinheiro).
 *
 * Obs.: `formatMoeda`/`formatNumero` usam Intl.NumberFormat, que separa "R$" do
 * número com NBSP (U+00A0). Normalizamos NBSP→espaço nos asserts pra não ficar
 * frágil entre versões de ICU/Node.
 */
const nbsp = (s: string) => s.split(String.fromCharCode(160)).join(String.fromCharCode(32));

describe('formatMoeda', () => {
  it('formata valor positivo em BRL', () => {
    expect(nbsp(formatMoeda(1234.56))).toBe('R$ 1.234,56');
  });

  it('zero', () => {
    expect(nbsp(formatMoeda(0))).toBe('R$ 0,00');
  });

  it('arredonda pra 2 casas (half-up neste ICU)', () => {
    expect(nbsp(formatMoeda(1.005))).toBe('R$ 1,01');
    expect(nbsp(formatMoeda(1.994))).toBe('R$ 1,99');
    expect(nbsp(formatMoeda(1.999))).toBe('R$ 2,00');
  });

  it('milhar e milhão com separador de ponto', () => {
    expect(nbsp(formatMoeda(1_000))).toBe('R$ 1.000,00');
    expect(nbsp(formatMoeda(1_234_567.89))).toBe('R$ 1.234.567,89');
  });

  it('valor negativo', () => {
    expect(nbsp(formatMoeda(-50.5))).toBe('-R$ 50,50');
  });
});

describe('formatNumeroCompacto', () => {
  it('milhares → "1,2k" (vírgula pt-BR, sem ,0)', () => {
    expect(formatNumeroCompacto(1234)).toBe('1,2k');
    expect(formatNumeroCompacto(1000)).toBe('1k');
  });
  it('milhões → M, e 999.999 NÃO vira "1000k"', () => {
    expect(formatNumeroCompacto(1_234_567)).toBe('1,2M');
    expect(formatNumeroCompacto(999_999)).toBe('1M');
  });
  it('abaixo de mil delega pro formatNumero (pt-BR)', () => {
    expect(formatNumeroCompacto(999)).toBe('999');
  });
  it('negativo preserva o sinal', () => {
    expect(formatNumeroCompacto(-1500)).toBe('-1,5k');
  });
});

describe('formatMoedaCompacta', () => {
  it('milhões → sufixo M', () => {
    expect(formatMoedaCompacta(1_500_000)).toBe('R$ 1.5M');
    expect(formatMoedaCompacta(2_000_000)).toBe('R$ 2.0M');
  });

  it('milhares → sufixo k', () => {
    expect(formatMoedaCompacta(12_300)).toBe('R$ 12.3k');
    expect(formatMoedaCompacta(1_000)).toBe('R$ 1.0k');
  });

  it('abaixo de mil cai no formato completo', () => {
    expect(nbsp(formatMoedaCompacta(999))).toBe('R$ 999,00');
    expect(nbsp(formatMoedaCompacta(0))).toBe('R$ 0,00');
  });

  it('fronteira exata de 1000 e 1000000', () => {
    expect(formatMoedaCompacta(999_999)).toBe('R$ 1000.0k');
    expect(formatMoedaCompacta(1_000_000)).toBe('R$ 1.0M');
  });
});

describe('formatNumero', () => {
  it('inteiro com milhar', () => {
    expect(nbsp(formatNumero(1_234_567))).toBe('1.234.567');
  });

  it('decimal com vírgula', () => {
    expect(nbsp(formatNumero(1234.5))).toBe('1.234,5');
  });

  it('zero', () => {
    expect(formatNumero(0)).toBe('0');
  });
});

describe('formatPercent', () => {
  it('default 1 casa, vírgula decimal', () => {
    expect(formatPercent(12.34)).toBe('12,3%');
  });

  it('0 casas', () => {
    expect(formatPercent(50, 0)).toBe('50%');
  });

  it('2 casas', () => {
    expect(formatPercent(12.345, 2)).toBe('12,35%');
  });

  it('valor já vem em pontos percentuais (50 = 50%, não 5000%)', () => {
    expect(formatPercent(100)).toBe('100,0%');
    expect(formatPercent(0)).toBe('0,0%');
  });
});

describe('maskDinheiro', () => {
  it('monta centavos da direita pra esquerda', () => {
    expect(maskDinheiro('123456')).toBe('1.234,56');
    expect(maskDinheiro('5')).toBe('0,05');
    expect(maskDinheiro('100')).toBe('1,00');
  });

  it('string vazia → vazio', () => {
    expect(maskDinheiro('')).toBe('');
  });

  it('ignora não-dígitos', () => {
    expect(maskDinheiro('R$ 1.234,56')).toBe('1.234,56');
  });

  it('milhões com separador de milhar', () => {
    expect(maskDinheiro('123456789')).toBe('1.234.567,89');
  });

  it('remove zeros à esquerda mas mantém centavos', () => {
    expect(maskDinheiro('000099')).toBe('0,99');
  });
});

describe('parseDinheiro', () => {
  it('converte BR pra number', () => {
    expect(parseDinheiro('1.234,56')).toBe(1234.56);
    expect(parseDinheiro('0,05')).toBe(0.05);
  });

  it('vazio → 0', () => {
    expect(parseDinheiro('')).toBe(0);
  });

  it('inválido → 0', () => {
    expect(parseDinheiro('abc')).toBe(0);
  });

  it('round-trip com maskDinheiro mantém o valor', () => {
    for (const cents of ['1', '99', '100', '123456', '999999999']) {
      const masked = maskDinheiro(cents);
      const back = parseDinheiro(masked);
      // o valor em reais = centavos/100
      expect(back).toBeCloseTo(Number(cents) / 100, 2);
    }
  });
});

describe('isValidCNPJ (guarda de UX, não fonte da verdade)', () => {
  it('CNPJ válido conhecido', () => {
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true);
  });

  it('14 dígitos iguais é inválido', () => {
    expect(isValidCNPJ('11.111.111/1111-11')).toBe(false);
  });

  it('comprimento errado é inválido', () => {
    expect(isValidCNPJ('123')).toBe(false);
  });

  it('dígito verificador errado é inválido', () => {
    expect(isValidCNPJ('11.222.333/0001-82')).toBe(false);
  });
});

describe('stripMask', () => {
  it('remove tudo que não é dígito', () => {
    expect(stripMask('R$ 1.234,56')).toBe('123456');
    expect(stripMask('(11) 97053-5832')).toBe('11970535832');
  });
});
