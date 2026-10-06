import { describe, expect, it } from 'vitest';
import { custoMedioDepois, precoPorUnidade } from './insumo';

describe('insumo — contas da tela', () => {
  it('prévia do custo médio bate com a do servidor', () => {
    expect(custoMedioDepois(20, 40, 10, 46)).toBeCloseTo(42, 6);
    expect(custoMedioDepois(-5, 40, 10, 46)).toBe(46);
  });
  it('compra pelo total da nota: R$ 460 por 10 kg = R$ 46/kg', () => {
    expect(precoPorUnidade(460, 10)).toBe(46);
    expect(precoPorUnidade(460, 0)).toBeNull();
    expect(precoPorUnidade(null, 10)).toBeNull();
  });
});
