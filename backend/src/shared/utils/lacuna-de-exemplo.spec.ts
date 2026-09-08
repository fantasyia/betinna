import { describe, expect, it } from 'vitest';
import { lacunasDeExemplo } from './interpolate';

/**
 * Lacuna que o MODELO copiou do exemplo do prompt.
 *
 * Bateria de 08/09, trilho de prospecção: em 2 de 6 rodadas a abertura saiu
 * pro representante assim —
 *
 *   "A gente encontrou seu perfil [fonte_prospeccao] e fiquei interessada…"
 *
 * O prompt usava `[fonte_prospeccao]` como lacuna dentro de um exemplo de
 * mensagem; às vezes o modelo preenchia, às vezes copiava o exemplo inteiro.
 * A trava existente só via `{{chave}}`, que é variável NOSSA — este caso passa
 * batido: não vira FALHOU, não vira log, não vira alarme. Sai bonito pro
 * sistema e quebrado pro cliente.
 *
 * O risco do conserto é o falso positivo: recusar mensagem legítima é pior que
 * o bug, porque cala a conversa inteira. Por isso metade destes testes é sobre
 * o que NÃO pode ser pego.
 */
describe('lacuna de exemplo no texto do modelo', () => {
  it('pega o caso real que chegou no representante', () => {
    expect(
      lacunasDeExemplo('A gente encontrou seu perfil [fonte_prospeccao] e fiquei interessada'),
    ).toEqual(['[fonte_prospeccao]']);
  });

  it('pega as outras caras de lacuna de template', () => {
    expect(lacunasDeExemplo('Olá <nome_cliente>, tudo bem?')).toEqual(['<nome_cliente>']);
    expect(lacunasDeExemplo('atendemos %cidade% e região')).toEqual(['%cidade%']);
    expect(lacunasDeExemplo('setor: __segmento__')).toEqual(['__segmento__']);
  });

  it('NÃO confunde com a variável do template, que já tem dono', () => {
    // `{{chave}}` é responsabilidade do placeholdersPendentes — pegar aqui
    // também faria a mensagem de erro apontar pro lugar errado.
    expect(lacunasDeExemplo('Olá {{lead.nome}}, tudo bem?')).toEqual([]);
  });

  it('texto humano com colchete continua passando', () => {
    // Recusar mensagem legítima cala a conversa: é pior que o bug original.
    for (const frase of [
      'o desconto é [R$ 200] neste mês',
      'confira o anexo [1]',
      'veja o item [b] da proposta',
      'chegou em 3 dias [muito rápido]',
      'a faixa é de 220V a 380V (ver <b>tabela</b>)',
      'use o cupom BLACK [válido até sexta]',
    ]) {
      expect(lacunasDeExemplo(frase), frase).toEqual([]);
    }
  });

  it('não repete a mesma lacuna duas vezes', () => {
    expect(lacunasDeExemplo('[cidade] … de novo [cidade]')).toEqual(['[cidade]']);
  });

  it('texto limpo não gera achado nenhum', () => {
    expect(lacunasDeExemplo('Oi Ana, tudo bem? Posso te mandar a proposta hoje.')).toEqual([]);
  });
});
