import { describe, expect, it } from 'vitest';
import { ehNaoSei, normalizarValor } from './normalizar-valor.util';

/**
 * `NAO_SEI` é a lista canônica de AUSÊNCIA, e ela tem um consumidor que não é
 * óbvio: a rede determinística usa `ehNaoSei` pra decidir onde PODE resgatar
 * dado. Valor de ausência que não está na lista faz a rede concluir que o campo
 * já está preenchido — e ela para de agir justamente onde mais precisaria.
 */
describe('ehNaoSei — o que conta como ausência', () => {
  it.each([
    'nao sei',
    'nao informado',
    'nao confirmado',
    'nao informou',
    'desconhecido',
    'indefinido',
    'n/a',
    'na',
    '-',
    '?',
  ])('"%s" é ausência', (v) => {
    expect(ehNaoSei(v)).toBe(true);
  });

  /**
   * 🔴 O T1 grava LITERALMENTE `nao declarou` em `tensao_rede` quando a pessoa
   * não citou a tensão ("Não citou? Grave `nao declarou`"). Ela ficou de fora
   * da lista, e o efeito era a rede determinística desistir de resgatar a
   * tensão exatamente quando o T1 tinha acabado de registrar que ela falta.
   */
  it.each(['nao declarou', 'não declarou', 'Nao Declarou', 'NÃO DECLAROU'])(
    'a sentinela do T1 conta como ausência: "%s"',
    (v) => {
      expect(ehNaoSei(v)).toBe(true);
    },
  );

  it('variações de gênero da mesma sentinela também contam', () => {
    expect(ehNaoSei('nao declarado')).toBe(true);
    expect(ehNaoSei('não declarada')).toBe(true);
  });

  /**
   * ⚠️ Vazio NÃO passa por aqui, e isso é de propósito: quem chama trata os dois
   * casos separados — `v == null || String(v).trim() === '' || ehNaoSei(v)`.
   * Documentado porque é a pergunta que aparece ao ler a lista pela primeira vez.
   */
  it('vazio NÃO é tratado por ehNaoSei — quem trata é o chamador', () => {
    expect(ehNaoSei('')).toBe(false);
    expect(ehNaoSei(null)).toBe(false);
    expect(ehNaoSei(undefined)).toBe(false);
  });

  /**
   * O outro lado do mesmo risco: alargar demais faria a rede sobrescrever
   * resposta de cliente. Valor concreto NUNCA é ausência.
   */
  it.each(['220V', '127V', '63', '63A', 'comercio', 'residencia', 'nao tenho certeza se é 220'])(
    'valor concreto NÃO é ausência: "%s"',
    (v) => {
      expect(ehNaoSei(v)).toBe(false);
    },
  );

  it('normalizarValor tira acento e baixa a caixa — é o que faz as variações entrarem', () => {
    expect(normalizarValor('NÃO DECLAROU')).toBe('nao declarou');
    expect(normalizarValor('  Não Sei  ')).toBe('nao sei');
  });
});
