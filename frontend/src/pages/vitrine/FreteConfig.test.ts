import { describe, expect, it } from 'vitest';
import { corpoDoForm, formDoStatus } from './FreteConfig';

/** Frete (Vitrine → Configuração): sugestão no primeiro uso e o corpo do PUT. */

const sugestao = {
  pesoMaxVolumeKg: 25,
  embalagemIndividual: {
    nome: 'Embalagem individual',
    comprimentoCm: 36,
    larguraCm: 26,
    alturaCm: 3,
    pesoVazioG: 50,
    capacidadePecas: 1,
  },
  retiradaMinimoPecas: 1000,
};

describe('formDoStatus', () => {
  it('primeiro uso: teto, embalagem individual e retirada sugeridos; caixa grande sem peso e capacidade', () => {
    const f = formDoStatus({ conectado: false, config: {}, sugestao, falta: [] });
    expect(f.ativo).toBe(false);
    expect(f.ambiente).toBe('sandbox');
    expect(f.pesoMaxVolumeKg).toBe('25');
    expect(f.usarIndividual).toBe(true);
    expect(f.individual.pesoVazioG).toBe('50');
    expect(f.retiradaMinimo).toBe('1000');
    expect(f.caixas).toEqual([
      {
        nome: 'Caixa grande',
        comprimentoCm: '50',
        larguraCm: '50',
        alturaCm: '38',
        pesoVazioG: '',
        capacidadePecas: '',
      },
    ]);
  });

  it('embalagem individual desligada fica desligada', () => {
    const f = formDoStatus({
      conectado: true,
      config: { embalagemIndividual: null },
      sugestao,
      falta: [],
    });
    expect(f.usarIndividual).toBe(false);
  });
});

describe('corpoDoForm', () => {
  const base = () => {
    const f = formDoStatus({ conectado: true, config: {}, sugestao, falta: [] });
    f.cepOrigem = '89200-000';
    f.caixas[0].pesoVazioG = '800';
    f.caixas[0].capacidadePecas = '80';
    return f;
  };

  it('monta o corpo com números (vírgula aceita) e CEP só com dígitos', () => {
    const f = base();
    f.pesoMaxVolumeKg = '24,5';
    const r = corpoDoForm(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corpo).toMatchObject({
      cepOrigem: '89200000',
      pesoMaxVolumeKg: 24.5,
      caixas: [
        {
          nome: 'Caixa grande',
          comprimentoCm: 50,
          larguraCm: 50,
          alturaCm: 38,
          pesoVazioG: 800,
          capacidadePecas: 80,
        },
      ],
      embalagemIndividual: { pesoVazioG: 50, capacidadePecas: 1 },
      retirada: { ativo: false, minimoPecas: 1000 },
    });
  });

  it('09/10: frete DESLIGADO salva com a caixa pela metade (sem peso e capacidade)', () => {
    const f = formDoStatus({ conectado: false, config: {}, sugestao, falta: [] });
    f.cepOrigem = '01310-100';
    const r = corpoDoForm(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corpo.caixas).toEqual([
      {
        nome: 'Caixa grande',
        comprimentoCm: 50,
        larguraCm: 50,
        alturaCm: 38,
        pesoVazioG: null,
        capacidadePecas: null,
      },
    ]);
  });

  it('pra LIGAR o frete, precisa de uma caixa completa', () => {
    const f = formDoStatus({ conectado: true, config: {}, sugestao, falta: [] });
    f.ativo = true;
    expect(corpoDoForm(f)).toEqual({
      ok: false,
      erro: 'Pra cobrar frete, complete ao menos uma caixa (medidas, peso vazio e peças que cabem)',
    });
    f.caixas[0].pesoVazioG = '800';
    f.caixas[0].capacidadePecas = '80';
    expect(corpoDoForm(f).ok).toBe(true);
  });

  it('digitado errado continua sendo erro (mesmo desligado)', () => {
    const f = base();
    f.caixas[0].capacidadePecas = '2,5';
    expect(corpoDoForm(f)).toEqual({
      ok: false,
      erro: 'Caixa grande: peças que cabem (número inteiro)',
    });
  });

  it('linha de caixa em branco é ignorada', () => {
    const f = base();
    f.caixas.push({
      nome: '',
      comprimentoCm: '',
      larguraCm: '',
      alturaCm: '',
      pesoVazioG: '',
      capacidadePecas: '',
    });
    const r = corpoDoForm(f);
    expect(r.ok && (r.corpo.caixas as unknown[]).length).toBe(1);
  });

  it('retirada ligada sem endereço: erro', () => {
    const f = base();
    f.retiradaAtivo = true;
    expect(corpoDoForm(f)).toEqual({ ok: false, erro: 'Retirada: informe o endereço' });
  });
});
