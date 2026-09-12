import { describe, expect, it } from 'vitest';
import {
  formatarCnpj,
  numeroPorExtenso,
  valorPorExtenso,
  variaveisDoContrato,
} from './contrato-variaveis.util';

/**
 * Este mapa é o contrato entre a proposta e o documento: nome de variável aqui
 * tem que bater com o `{{...}}` do modelo de 12/09. Errar não quebra nada — o
 * campo sai vazio e só se descobre lendo o PDF assinado.
 */
const base = {
  valor: 1566,
  criadoEm: new Date('2026-09-03T12:00:00Z'),
  clienteNome: 'INDÚSTRIA EXEMPLO LTDA',
  cnpj: '16774052000155',
  endereco: {
    logradouro: 'Rua XV de Novembro',
    numero: '743',
    complemento: 'Sala 2',
    bairro: 'Centro',
    cidade: 'Dracena',
    uf: 'sp',
  },
  prazoEntregaDias: 30,
  prazoInstalacaoDias: null,
};

/** As 16 variáveis do modelo — a lista veio do próprio .docx, não da cabeça. */
const NO_MODELO = [
  'aluguel_mensal',
  'aluguel_mensal_extenso',
  'cnpj',
  'comarca',
  'data_extenso',
  'endereco_bairro',
  'endereco_cidade',
  'endereco_complemento',
  'endereco_logradouro',
  'endereco_numero',
  'endereco_uf',
  'prazo_entrega_dias',
  'prazo_entrega_extenso',
  'prazo_instalacao_dias',
  'prazo_instalacao_extenso',
  'razao_social',
];

describe('variáveis do contrato', () => {
  it('manda exatamente as variáveis que o modelo tem — nem a mais, nem a menos', () => {
    expect(Object.keys(variaveisDoContrato(base)).sort()).toEqual(NO_MODELO);
  });

  it('preâmbulo: razão social, CNPJ formatado e endereço da sede', () => {
    const v = variaveisDoContrato(base);
    expect(v.razao_social).toBe('INDÚSTRIA EXEMPLO LTDA');
    expect(v.cnpj).toBe('16.774.052/0001-55');
    expect(v.endereco_logradouro).toBe('Rua XV de Novembro');
    expect(v.endereco_numero).toBe('743');
    expect(v.endereco_complemento).toBe('Sala 2');
    expect(v.endereco_bairro).toBe('Centro');
    expect(v.endereco_cidade).toBe('Dracena');
    expect(v.endereco_uf).toBe('SP');
  });

  it('cláusula 7.1: aluguel em número E por extenso', () => {
    const v = variaveisDoContrato(base);
    expect(v.aluguel_mensal).toBe('R$ 1.566,00');
    expect(v.aluguel_mensal_extenso).toBe('mil quinhentos e sessenta e seis reais');
  });

  it('cláusula 4: prazo em dias e por extenso; sem dado vai VAZIO, não inventado', () => {
    const v = variaveisDoContrato(base);
    expect(v.prazo_entrega_dias).toBe('30');
    expect(v.prazo_entrega_extenso).toBe('trinta');
    expect(v.prazo_instalacao_dias).toBe('');
    expect(v.prazo_instalacao_extenso).toBe('');
  });

  it('cláusula 13.8: comarca = cidade-UF da sede', () => {
    expect(variaveisDoContrato(base).comarca).toBe('Dracena-SP');
    expect(variaveisDoContrato({ ...base, endereco: { ...base.endereco, uf: null } }).comarca).toBe(
      'Dracena',
    );
  });

  it('escreve a data por extenso, como o fecho pede', () => {
    expect(variaveisDoContrato(base).data_extenso).toBe('3 de setembro de 2026');
  });

  it('campo sem dado vai como string vazia, nunca ausente', () => {
    const v = variaveisDoContrato({
      ...base,
      cnpj: null,
      endereco: {
        logradouro: null,
        numero: null,
        complemento: null,
        bairro: null,
        cidade: null,
        uf: null,
      },
    });
    for (const k of ['cnpj', 'endereco_logradouro', 'endereco_uf', 'comarca']) {
      expect(v[k]).toBe('');
    }
  });
});

describe('número por extenso (pt-BR)', () => {
  it.each([
    [0, 'zero'],
    [1, 'um'],
    [15, 'quinze'],
    [20, 'vinte'],
    [21, 'vinte e um'],
    [100, 'cem'],
    [101, 'cento e um'],
    [200, 'duzentos'],
    [522, 'quinhentos e vinte e dois'],
    [1000, 'mil'],
    [1001, 'mil e um'],
    [1500, 'mil e quinhentos'],
    [1566, 'mil quinhentos e sessenta e seis'],
    [2020, 'dois mil e vinte'],
    [2301, 'dois mil trezentos e um'],
    [12000, 'doze mil'],
    [100000, 'cem mil'],
    [1000000, 'um milhão'],
    [2500000, 'dois milhões e quinhentos mil'],
  ])('%i → %s', (n, esperado) => {
    expect(numeroPorExtenso(n)).toBe(esperado);
  });
});

describe('valor por extenso', () => {
  it.each([
    [522, 'quinhentos e vinte e dois reais'],
    [1566.5, 'mil quinhentos e sessenta e seis reais e cinquenta centavos'],
    [1, 'um real'],
    [0.01, 'um centavo'],
    [0, 'zero reais'],
    [1000000, 'um milhão de reais'],
    [1000000.5, 'um milhão de reais e cinquenta centavos'],
    [1234567, 'um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete reais'],
  ])('%s → %s', (v, esperado) => {
    expect(valorPorExtenso(v)).toBe(esperado);
  });
});

describe('CNPJ', () => {
  it('formata 14 dígitos e deixa o resto como veio', () => {
    expect(formatarCnpj('16774052000155')).toBe('16.774.052/0001-55');
    expect(formatarCnpj('16.774.052/0001-55')).toBe('16.774.052/0001-55');
    expect(formatarCnpj('123')).toBe('123');
    expect(formatarCnpj('')).toBe('');
  });
});
