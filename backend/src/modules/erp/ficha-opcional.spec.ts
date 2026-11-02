import { describe, expect, it } from 'vitest';
import { extrasDaDiferenca, fichaDoOpcional, lerExtras } from './ficha-opcional';

/** Ficha do opcional = base + extras (02/11, "+ emblema"). */
const tecido = {
  insumoId: 'tec',
  consumoPorPeca: 0.32,
  etapa: 'FACCAO' as const,
  observacao: null,
  uso: null,
};
const linha = {
  insumoId: 'lin',
  consumoPorPeca: 40,
  etapa: 'FACCAO' as const,
  observacao: null,
  uso: null,
};
const emborrachado = {
  insumoId: 'emb',
  consumoPorPeca: 1,
  etapa: 'ACABAMENTO' as const,
  observacao: null,
  uso: null,
};
const base = {
  custoFaccaoPrevisto: 4.5,
  observacoes: 'obs',
  acabamento: ['embalar'],
  acabamentoTamanhos: null,
  itens: [tecido, linha],
};

describe('ficha do opcional', () => {
  it('monta base + extras: itens da base, os extras, e o serviço extra somado', () => {
    const f = fichaDoOpcional(base, {
      itens: [emborrachado],
      acabamento: ['aplicar-emborrachado'],
    });
    expect(f.itens).toEqual([tecido, linha, emborrachado]);
    expect(f.acabamento).toEqual(['embalar', 'aplicar-emborrachado']);
    expect(f.custoFaccaoPrevisto).toBe(4.5);
  });

  it('mudou a base → a do opcional muda junto (é só remontar)', () => {
    const extras = { itens: [emborrachado], acabamento: [] };
    const nova = { ...base, itens: [{ ...tecido, consumoPorPeca: 0.35 }, linha] };
    expect(fichaDoOpcional(nova, extras).itens[0].consumoPorPeca).toBe(0.35);
  });

  it('prévia de uma ficha copiada à mão: o a mais vira extra; o que falta aparece', () => {
    const copiada = {
      ...base,
      acabamento: ['embalar', 'aplicar-emborrachado'],
      itens: [tecido, emborrachado], // perdeu a linha da base
    };
    const r = extrasDaDiferenca(base, copiada);
    expect(r.extras).toEqual({ itens: [emborrachado], acabamento: ['aplicar-emborrachado'] });
    expect(r.divergencias).toEqual([linha]);
  });

  it('lerExtras: null = ficha comum', () => {
    expect(lerExtras(null)).toBeNull();
    expect(lerExtras({ itens: [emborrachado] })).toEqual({ itens: [emborrachado], acabamento: [] });
  });
});
