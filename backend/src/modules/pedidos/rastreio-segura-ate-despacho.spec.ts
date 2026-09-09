import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * O aviso de rastreio SEGURA até o despacho — e agora diz isso em voz alta.
 *
 * O Tiny grava o código de rastreio na COMPRA DA ETIQUETA (situação 7, que aqui
 * vira EM_SEPARACAO), não no despacho. Avisar o cliente nesse instante manda
 * "a caminho" com um rastreio que não se move por horas ou dias — por isso o
 * emissor só dispara em ENVIADO. Isso é decisão, não defeito.
 *
 * O que ERA defeito é o silêncio: o caminho normal não deixava rastro nenhum.
 * A sessão de testes gastou três investigações e abriu um card vermelho
 * ("pedido do site NUNCA gera aviso de rastreio") sobre um sistema que estava
 * fazendo exatamente o combinado. Ausência de log virou, pra quem olhava de
 * fora, ausência de comportamento.
 *
 * Estrutural de propósito: o que precisa ser garantido é que a condição e a
 * explicação andem JUNTAS. Um teste de comportamento sobre o log seria mais
 * frágil e diria menos.
 */
const FONTE = readFileSync(join(__dirname, 'pedido-erp-sync.service.ts'), 'utf8');

describe('rastreio que chega antes do despacho', () => {
  it('o aviso continua condicionado a ENVIADO', () => {
    // Se alguém afrouxar isto, o cliente volta a receber "a caminho" com o
    // pacote na prateleira.
    expect(FONTE).toContain("statusFinal === 'ENVIADO'");
  });

  it('e quando SEGURA, o log diz por quê', () => {
    const i = FONTE.indexOf('podeAvisarDespacho) await this.dispararRastreio');
    const depois = FONTE.slice(i, i + 1200);

    expect(depois).toContain('else if (ganhouRastreio)');
    expect(depois).toContain('SEGURA até o despacho');
  });

  it('o log só sai quando o código ACABOU de chegar', () => {
    // `ganhouRastreio` é a transição (tinha código? não → sim). Sem isso, toda
    // rodada de sync repetiria a mesma linha pro mesmo pedido, e log que se
    // repete sem novidade é ruído que ensina a ignorar o log.
    expect(FONTE).toContain(
      'const ganhouRastreio = Boolean(rastreioCodigo) && !existente.rastreioCodigo',
    );
  });
});
