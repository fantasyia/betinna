import { describe, expect, it } from 'vitest';
import {
  FreteRegraError,
  faltandoNoFrete,
  montarVolumes,
  retiradaLiberada,
  somarCotacoes,
  type ConfigFrete,
} from './frete';

const caixaGrande = {
  nome: 'Caixa grande',
  comprimentoCm: 50,
  larguraCm: 50,
  alturaCm: 38,
  pesoVazioG: 800,
  capacidadePecas: 80,
};
const caixaPequena = {
  nome: 'Caixa pequena',
  comprimentoCm: 30,
  larguraCm: 30,
  alturaCm: 20,
  pesoVazioG: 300,
  capacidadePecas: 15,
};
const cfg: ConfigFrete = {
  cepOrigem: '89200000',
  pesoMaxVolumeKg: 25,
  embalagemIndividual: {
    nome: 'Embalagem individual',
    comprimentoCm: 36,
    larguraCm: 26,
    alturaCm: 3,
    pesoVazioG: 50,
    capacidadePecas: 1,
  },
  caixas: [caixaGrande, caixaPequena],
};
const pecas = (n: number, g: number) => Array.from({ length: n }, () => g);

describe('montarVolumes', () => {
  it('peça avulsa vai na embalagem individual', () => {
    expect(montarVolumes([300], cfg)).toEqual([
      expect.objectContaining({ embalagem: 'Embalagem individual', pecas: 1, pesoG: 350 }),
    ]);
  });

  it('poucas peças: a MENOR caixa que comporta', () => {
    const v = montarVolumes(pecas(10, 300), cfg);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ embalagem: 'Caixa pequena', pecas: 10, pesoG: 3300 });
  });

  it('o teto de 25 kg manda mais um volume mesmo com espaço na caixa', () => {
    // 80 peças de 400 g = 32 kg + caixa: não cabe num volume só.
    const v = montarVolumes(pecas(80, 400), cfg);
    expect(v.length).toBe(2);
    expect(v.every((x) => x.pesoG <= 25_000)).toBe(true);
    expect(v.reduce((s, x) => s + x.pecas, 0)).toBe(80);
  });

  it('pedido grande: enche a caixa grande e o resto vai na menor que cabe', () => {
    const v = montarVolumes(pecas(170, 200), cfg);
    expect(v.map((x) => [x.embalagem, x.pecas])).toEqual([
      ['Caixa grande', 80],
      ['Caixa grande', 80],
      ['Caixa pequena', 10],
    ]);
    expect(v[0].pesoG).toBe(800 + 80 * 200);
  });

  it('peças mais pesadas primeiro e nenhuma peça perdida (pesos misturados)', () => {
    const misto = [...pecas(30, 600), ...pecas(60, 250)];
    const v = montarVolumes(misto, cfg);
    expect(v.reduce((s, x) => s + x.pecas, 0)).toBe(90);
    expect(v.every((x) => x.pesoG <= 25_000)).toBe(true);
    const total = v.reduce((s, x) => s + x.pesoG, 0);
    const embalagens = v.reduce(
      (s, x) =>
        s + (x.embalagem === 'Caixa grande' ? 800 : x.embalagem === 'Caixa pequena' ? 300 : 50),
      0,
    );
    expect(total - embalagens).toBe(30 * 600 + 60 * 250);
  });

  it('sem embalagem individual: a peça avulsa vai na menor caixa', () => {
    const v = montarVolumes([300], { ...cfg, embalagemIndividual: null });
    expect(v[0].embalagem).toBe('Caixa pequena');
  });

  it('peça sem peso não vira frete barato: recusa', () => {
    expect(() => montarVolumes([300, 0], cfg)).toThrow(FreteRegraError);
  });

  it('peça que sozinha passa do teto: recusa (peso errado no cadastro)', () => {
    expect(() => montarVolumes([30_000], cfg)).toThrow(FreteRegraError);
  });

  it('sem caixa cadastrada: recusa', () => {
    expect(() => montarVolumes([300], { ...cfg, caixas: [] })).toThrow(FreteRegraError);
  });
});

describe('somarCotacoes', () => {
  const pac = (precoC: number, prazo: number) => ({
    id: 1,
    nome: 'PAC',
    transportadora: 'Correios',
    precoC,
    prazoDias: prazo,
  });
  const jad = (precoC: number, prazo: number) => ({
    id: 3,
    nome: '.Package',
    transportadora: 'Jadlog',
    precoC,
    prazoDias: prazo,
  });

  it('soma os volumes por serviço, prazo é o maior, mais barato primeiro', () => {
    const r = somarCotacoes([
      [pac(5000, 5), jad(4000, 7)],
      [pac(3000, 6), jad(3500, 7)],
    ]);
    expect(r).toEqual([
      { ...jad(7500, 7), volumes: 2 },
      { ...pac(8000, 6), volumes: 2 },
    ]);
  });

  it('serviço que não atende algum volume sai da lista', () => {
    const r = somarCotacoes([[pac(5000, 5), jad(4000, 7)], [jad(3500, 7)]]);
    expect(r.map((o) => o.id)).toEqual([3]);
  });

  it('nenhum volume: nenhuma opção', () => {
    expect(somarCotacoes([])).toEqual([]);
  });
});

describe('retirada e configuração', () => {
  const comRetirada: ConfigFrete = {
    ...cfg,
    retirada: { ativo: true, minimoPecas: 1000, endereco: 'Rua X, 10', horario: '8h–17h' },
  };

  it('retirada só a partir do mínimo de peças', () => {
    expect(retiradaLiberada(comRetirada, 999)).toBe(false);
    expect(retiradaLiberada(comRetirada, 1000)).toBe(true);
  });

  it('retirada sem endereço não aparece', () => {
    expect(
      retiradaLiberada(
        { ...comRetirada, retirada: { ...comRetirada.retirada, endereco: ' ' } },
        2000,
      ),
    ).toBe(false);
  });

  it('diz o que falta pra cotar', () => {
    expect(faltandoNoFrete(cfg)).toEqual([]);
    expect(faltandoNoFrete({})).toEqual([
      'CEP de origem',
      'peso máximo por volume',
      'ao menos uma caixa completa',
    ]);
  });
});
