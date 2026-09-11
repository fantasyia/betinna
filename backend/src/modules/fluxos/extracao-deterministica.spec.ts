import { describe, expect, it } from 'vitest';
import { correnteNaFrase, extrairDeterministico, tensaoNaFrase } from './extracao-deterministica';
import { parseVariaveisGravadas } from './variaveis-gravadas.util';

/**
 * As falas são transcrições REAIS das conversas de 09-11/09 registradas nos
 * cards — não exemplos inventados. O defeito que isto fecha foi visto assim:
 *
 *   04:52:47  CLIENTE → "queimou o freezer da minha padaria. o disjuntor geral
 *                        aqui e de 63A e a tensao e 220V"
 *   04:53:03  BOT     → "E qual o padrão de energia aí, 110V, 220V ou 380V?"
 *   04:53:21  CLIENTE → "e 220V mesmo, ja tinha falado"
 */
const C1 = parseVariaveisGravadas([
  'corrente_quadro',
  'tensao_rede: 127V | 220V | 380V | 440V | nao sei',
  'perfil_cliente: comercio | residencia | condominio | carro_eletrico',
  'o_que_proteger',
  'origem_corrente: disjuntor | conta | estimativa',
]);

describe('tensaoNaFrase', () => {
  it.each([
    [
      'queimou o freezer da minha padaria. o disjuntor geral aqui e de 63A e a tensao e 220V',
      '220',
    ],
    ['e 220V mesmo, ja tinha falado', '220'],
    ['a rede aqui e 380 trifasico', '380'],
    ['é 220 v', '220'],
    ['aqui é 127 volts', '127'],
    ['o padrão é 380', '380'],
  ])('acha em %j', (frase, esperado) => {
    expect(tensaoNaFrase(frase)?.valor).toBe(esperado);
  });

  /**
   * ⚠️ O custo de errar não é simétrico: campo vazio faz o bot perguntar de
   * novo; campo errado manda o cliente pro produto errado. Por isso número
   * solto NUNCA vira tensão.
   */
  it.each([
    ['meu freezer tem 220 litros', 'unidade errada'],
    ['o disjuntor geral aqui e de 63A', 'corrente, não tensão'],
    ['custou 380 reais', 'dinheiro'],
    ['tenho 127 metros de cabo', 'metro'],
    ['sao 220 clientes por dia', 'número solto, sem pista'],
    ['nao sei qual é', 'sem número'],
    ['', 'vazio'],
  ])('NÃO inventa em %j (%s)', (frase) => {
    expect(tensaoNaFrase(frase)).toBeNull();
  });
});

describe('correnteNaFrase', () => {
  it.each([
    ['o disjuntor geral aqui e de 63A', '63A'],
    ['63 A', '63A'],
    ['é de 50 amperes', '50A'],
    ['o disjuntor maior é 100', '100A'],
    ['no quadro aparece 40', '40A'],
  ])('acha em %j', (frase, esperado) => {
    expect(correnteNaFrase(frase)?.valor).toBe(esperado);
  });

  it.each([
    ['a tensao e 220V', 'tensão veta'],
    ['tenho 63 anos', 'idade'],
    ['sao 2 quadros', 'abaixo do mínimo plausível'],
    ['a rede aqui e 380 trifasico', 'pista de tensão, não de corrente'],
  ])('NÃO inventa em %j (%s)', (frase) => {
    expect(correnteNaFrase(frase)).toBeNull();
  });
});

describe('extrairDeterministico — o caso que abriu o card', () => {
  const FALA =
    'queimou o freezer da minha padaria. o disjuntor geral aqui e de 63A e a tensao e 220V';

  it('a frase completa entrega os dois campos que os portões leem', () => {
    expect(extrairDeterministico(C1, FALA, {})).toEqual({
      corrente_quadro: '63A',
      tensao_rede: '220V',
    });
  });

  /** É rede, não substituto: o que o modelo trouxe manda. */
  it('NÃO sobrescreve o que o modelo já extraiu', () => {
    const r = extrairDeterministico(C1, FALA, { tensao_rede: '380V' });
    expect(r.tensao_rede).toBeUndefined();
    expect(r.corrente_quadro).toBe('63A');
  });

  it('valor presente porém VAZIO conta como lacuna', () => {
    expect(extrairDeterministico(C1, FALA, { tensao_rede: '  ' }).tensao_rede).toBe('220V');
  });

  it('campo que o nó não declarou nunca é gravado', () => {
    const soCorrente = parseVariaveisGravadas(['corrente_quadro']);
    expect(extrairDeterministico(soCorrente, FALA, {})).toEqual({ corrente_quadro: '63A' });
  });
});

/**
 * 🔴 O "110V" é falha GARANTIDA, não probabilística: o TEXTO FIXO do fluxo
 * pergunta *"110V, 220V ou 380V?"* e o enum do nó é
 * `127V | 220V | 380V | 440V | nao sei`. Quem responde exatamente o que o bot
 * ofereceu não tem valor possível — e é perguntado de novo, toda vez.
 *
 * No Brasil "110" é como se chama a rede de 127V (mesma tomada), então o mapa
 * não é chute: é o nome popular do valor que o enum já aceita.
 */
describe('110V — o que o próprio bot oferece e o enum não aceita', () => {
  it('"110" vira 127V quando o nó aceita 127V e não aceita 110V', () => {
    expect(extrairDeterministico(C1, 'aqui é 110V', {}).tensao_rede).toBe('127V');
  });

  it('se o nó declarar 110V, o declarado MANDA (sem mapa)', () => {
    const com110 = parseVariaveisGravadas(['tensao_rede: 110V | 220V']);
    expect(extrairDeterministico(com110, 'aqui é 110V', {}).tensao_rede).toBe('110V');
  });

  it('não grava valor fora do enum do nó', () => {
    const so220 = parseVariaveisGravadas(['tensao_rede: 220V']);
    expect(extrairDeterministico(so220, 'aqui é 380V', {}).tensao_rede).toBeUndefined();
  });
});
