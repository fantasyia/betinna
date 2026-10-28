import { describe, expect, it } from 'vitest';
import { juntarItensDaFicha, type LinhaFichaImpressao } from './ficha-impressao.service';

/** Ficha da OP impressa: o mesmo insumo em várias linhas (Léo, 27/10). */
describe('juntarItensDaFicha', () => {
  const linha = (x: Partial<LinhaFichaImpressao>): LinhaFichaImpressao => ({
    insumoId: 'el45',
    corFixaId: null,
    consumoPorPeca: 1,
    porTamanho: null,
    etapa: 'FACCAO',
    observacao: null,
    uso: null,
    nome: 'Elástico 45 mm',
    tipo: 'AVIAMENTO',
    unidade: 'METRO',
    cor: null,
    ...x,
  });

  it('elástico no cós e na barra vai pra facção como UM total, com os usos', () => {
    const r = juntarItensDaFicha([
      linha({ uso: 'cós', consumoPorPeca: 0.8 }),
      linha({ uso: 'barra', consumoPorPeca: 0.5 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].consumoPorPeca).toBeCloseTo(1.3, 6);
    expect(r[0].porTamanho).toBeNull();
    expect(r[0].usos).toEqual(['cós', 'barra']);
  });

  it('por tamanho soma tamanho a tamanho; linha sem o tamanho entra com o médio dela', () => {
    const r = juntarItensDaFicha([
      linha({ uso: 'cós', consumoPorPeca: 0.8, porTamanho: { P: 0.76, G: 0.84 } }),
      linha({ uso: 'barra', consumoPorPeca: 0.5 }),
      linha({ uso: 'punho', consumoPorPeca: 0.2, porTamanho: { P: 0, M: 0.2 } }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].porTamanho!.P).toBeCloseTo(0.76 + 0.5 + 0, 6);
    expect(r[0].porTamanho!.M).toBeCloseTo(0.8 + 0.5 + 0.2, 6);
    expect(r[0].porTamanho!.G).toBeCloseTo(0.84 + 0.5 + 0.2, 6);
    expect(r[0].consumoPorPeca).toBeCloseTo(1.5, 6);
  });

  it('etapa diferente ou cor fixa diferente não se misturam', () => {
    const r = juntarItensDaFicha([
      linha({ uso: 'cós' }),
      linha({ uso: 'etiqueta', etapa: 'ACABAMENTO' }),
      linha({ uso: 'viés', corFixaId: 'branco', cor: 'Branco' }),
      linha({ insumoId: 'cordao', nome: 'Cordão' }),
    ]);
    expect(r).toHaveLength(4);
    expect(r.find((x) => x.cor === 'Branco')?.usos).toEqual(['viés']);
  });
});
