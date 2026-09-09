import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A IA tem UMA porta, e ela é guardada.
 *
 * O guard de falha forçada nasceu colado em UMA das quatro chamadas de
 * `gerarRespostaIa` (o turno de resposta) e as outras três ficaram de fora —
 * inclusive o OPENER, que é o caso que mais importa: IA que cai antes de falar
 * deixa o cliente sem absolutamente nada.
 *
 * A sessão de testes foi usar o gancho pra derrubar o pós-venda e ele passou
 * reto, porque aquele nó fala primeiro pelo opener. Duas execuções, nenhuma
 * acendeu o ramo `erro`.
 *
 * Este teste é estrutural de propósito: teste de comportamento cobre a chamada
 * que EXISTE hoje; o buraco foi uma chamada que ninguém lembrou de guardar. O
 * que precisa ser travado é a REGRA — só `chamarIa` fala com o provedor.
 */
const FONTE = readFileSync(join(__dirname, 'conversar-ia.service.ts'), 'utf8');

const corpoDoWrapper = (): string => {
  const i = FONTE.indexOf('private async chamarIa(');
  return i < 0 ? '' : FONTE.slice(i, i + 600);
};

describe('toda chamada de IA passa pela mesma porta', () => {
  it('só existe UMA chamada direta ao provedor — a de dentro do wrapper', () => {
    // Sem espaço em branco: pega também a forma quebrada em duas linhas
    // (`this.muller` quebrado antes de `.gerarRespostaIa`), que era uma das
    // estavam desguardadas.
    const semEspaco = FONTE.replace(/\s+/g, '');
    const diretas = semEspaco.split('this.muller.gerarRespostaIa').length - 1;

    expect(
      diretas,
      'chamada nova de IA fora do `chamarIa`: ela não passa pelo guard de teste, ' +
        'e foi assim que o opener ficou desguardado. Use `this.chamarIa(ctx, ...)`.',
    ).toBe(1);
  });

  it('e essa única chamada está DENTRO do `chamarIa`', () => {
    const w = corpoDoWrapper();

    expect(w).toContain('falharSePedidoPorTeste');
    expect(w).toContain('this.muller.gerarRespostaIa');
  });

  it('o wrapper roda o guard ANTES de chamar o provedor', () => {
    // Depois não adianta: o custo já foi gasto e a resposta já existe.
    const w = corpoDoWrapper();

    expect(w.indexOf('falharSePedidoPorTeste')).toBeLessThan(
      w.indexOf('this.muller.gerarRespostaIa'),
    );
  });
});
