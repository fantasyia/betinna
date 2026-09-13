import { describe, expect, it } from 'vitest';
import { pedidoRemocaoNoTexto } from './pedido-remocao.util';

/**
 * Auditoria 13/09/2026 (B-4): "PARAR"/"SAIR"/"STOP" sozinhos não casavam —
 * o padrão de opt-out que o mercado ensinou por SMS ficava sem efeito.
 */
describe('pedidoRemocaoNoTexto', () => {
  it.each(['PARAR', 'parar', 'Sair', 'STOP', 'cancelar', 'Descadastrar!', ' pare. '])(
    'palavra isolada como mensagem inteira conta: %s',
    (msg) => expect(pedidoRemocaoNoTexto(msg)).toBe(true),
  );

  it.each([
    'para de me mandar mensagem',
    'não quero mais receber',
    'me tira da lista',
    'quero sair da sua lista',
  ])('frase de remoção conta: %s', (msg) => expect(pedidoRemocaoNoTexto(msg)).toBe(true));

  it.each([
    'quero sair do prédio às 18h',
    'pode parar de fazer barulho lá fora?',
    'me tira uma dúvida',
    'vou cancelar o pedido de ontem',
    'oi, tudo bem?',
  ])('frase comum NÃO conta: %s', (msg) => expect(pedidoRemocaoNoTexto(msg)).toBe(false));
});
