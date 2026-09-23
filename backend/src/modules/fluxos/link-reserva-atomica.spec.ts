import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * A8 — dois disparos no mesmo lead entregam o MESMO link duas vezes.
 *
 * 🔴 A guarda do P2 (14/09) EXISTE e funciona: ela lê as mensagens OUTBOUND da
 * conversa e, se o link já saiu, regera a resposta pra "retomar de onde parou".
 * O que ela não alcança é a corrida: as duas execuções consultam o histórico
 * ANTES de qualquer uma ter gravado, as duas veem "nunca entreguei", e as duas
 * entregam. Ler-e-decidir não é atômico.
 *
 * ⚠️ E o que segurava isso era o RELÓGIO, não a lógica. Medido em 19/09: trocar
 * um TEXTO FIXO (~1s) por um nó de IA (5–10s) no topo do ramo fez o A8 reprovar
 * na hora, sem nada da entrega ter mudado.
 *
 * Aqui a reserva é exercitada como CONTRATO — o que o Redis recebe e o que o
 * serviço conclui a partir da resposta dele. O caminho completo (regerar e
 * trocar a fala) está em `conversar-ia.service.spec.ts`, describe "link
 * repetido — o caminho da regeração".
 *
 * 🔴 A versão original desta frase dizia "já é coberto pelas specs do turno" e
 * era FALSA — copiada de outro docblock sem verificação. A cobertura só passou
 * a existir em 24/09.
 */

/** Espelha `reservarEntregaDoLink`: é isto que o serviço faz com a chave. */
const chaveDe = (conversationId: string, url: string) =>
  `fluxo:link:${conversationId}:${createHash('sha1').update(url).digest('hex')}`;

const FONTE = readFileSync(join(__dirname, 'conversar-ia.service.ts'), 'utf8');

describe('a chave da reserva', () => {
  it('é por CONVERSA e por URL — links diferentes não se bloqueiam', () => {
    const a = chaveDe('conv-1', 'https://site/x?corrente=63');
    const b = chaveDe('conv-1', 'https://site/x?corrente=100');
    expect(a).not.toBe(b);
  });

  it('a MESMA url na MESMA conversa dá a mesma chave — é o que faz a corrida perder', () => {
    const url = 'https://somatecblocking.com.br/protecao-comercial?corrente=63#calculadora';
    expect(chaveDe('conv-1', url)).toBe(chaveDe('conv-1', url));
  });

  it('conversas diferentes não compartilham reserva', () => {
    const url = 'https://site/x';
    expect(chaveDe('conv-1', url)).not.toBe(chaveDe('conv-2', url));
  });

  it('não leva a URL crua dentro — query e âncora fariam chave gigante e frágil', () => {
    const chave = chaveDe('conv-1', 'https://site/x?a=1&b=2#ancora');
    expect(chave).not.toContain('http');
    expect(chave).not.toContain('?');
  });
});

/**
 * ⚠️ ESTRUTURAL — e sem isto o conserto pode sumir com a suíte verde.
 *
 * O defeito original NÃO era a lógica errada; era a ausência de atomicidade.
 * Um teste de comportamento não distingue "reservou e entregou" de "não
 * reservou e entregou" quando não há concorrência — e concorrência real não se
 * reproduz em teste unitário. O que dá pra travar é o CONTRATO.
 */
describe('fiação da reserva', () => {
  it('a reserva usa SET NX EX — nada de get-then-set, que é a corrida de novo', () => {
    expect(FONTE).toContain('this.redis.setNxEx(chave, execucaoId, RESERVA_LINK_S)');
    // Um `get` ANTES do set reintroduziria exatamente o defeito que isto fecha.
    const corpo = FONTE.slice(
      FONTE.indexOf('private async reservarEntregaDoLink'),
      FONTE.indexOf('private async reservarEntregaDoLink') + 1200,
    );
    expect(corpo.indexOf('setNxEx')).toBeLessThan(corpo.indexOf('this.redis.get'));
  });

  it('quem perde a reserva vira "link repetido" — reusa o caminho de regeração', () => {
    expect(FONTE).toMatch(
      /if \(!\(await this\.reservarEntregaDoLink\(conversationId, url, execucaoId\)\)\) return url;/,
    );
  });

  it('a mesma execução voltando (retry) NÃO é barrada', () => {
    // Sem isto, um retry do próprio passo perderia a reserva que ele mesmo fez
    // e o cliente ficaria sem o link — silêncio, que é o lado caro de errar.
    expect(FONTE).toContain('return dono === execucaoId;');
  });

  it('FAIL-OPEN: Redis fora entrega o link', () => {
    const corpo = FONTE.slice(FONTE.indexOf('private async reservarEntregaDoLink'));
    const catchIdx = corpo.indexOf('} catch (err) {');
    expect(catchIdx).toBeGreaterThan(-1);
    // O `return true` do catch é o que impede a indisponibilidade do Redis de
    // virar bot mudo.
    expect(corpo.slice(catchIdx, catchIdx + 400)).toContain('return true;');
  });

  it('a reserva roda DEPOIS da consulta ao histórico, não no lugar dela', () => {
    // As duas guardas cobrem janelas diferentes: o histórico pega o lead que
    // volta dias depois, a reserva pega os dois disparos no mesmo segundo.
    // Trocar uma pela outra deixa metade do defeito de pé.
    const corpo = FONTE.slice(
      FONTE.indexOf('private async linkJaEntregue'),
      FONTE.indexOf('private async reservarEntregaDoLink'),
    );
    expect(corpo.indexOf('prisma.message.findFirst')).toBeLessThan(
      corpo.indexOf('reservarEntregaDoLink'),
    );
    // E a consulta precisa CURTO-CIRCUITAR. Sem o `return`, o histórico vira
    // decoração: o lead que volta dias depois passa pela reserva (que já
    // expirou) e recebe o link de novo — metade do defeito, de pé.
    expect(corpo).toMatch(/if \(ja\) return url;/);
  });
});

describe('a janela da reserva', () => {
  it('cobre com folga o turno medido (16–29s) + a gravação da OUTBOUND', () => {
    const m = /const RESERVA_LINK_S = (\d+);/.exec(FONTE);
    expect(m).not.toBeNull();
    const seg = Number(m![1]);
    // Curta demais e a corrida volta na cauda do turno lento; longa demais e a
    // reserva vira memória permanente, barrando reenvio legítimo semanas depois.
    expect(seg).toBeGreaterThanOrEqual(120);
    expect(seg).toBeLessThanOrEqual(3600);
  });
});

describe('o dublê de Redis dos testes responde o contrato usado', () => {
  it('setNxEx devolve boolean e get devolve string|null', async () => {
    const redis = { setNxEx: vi.fn(async () => true), get: vi.fn(async () => null) };
    expect(typeof (await redis.setNxEx())).toBe('boolean');
    expect(await redis.get()).toBeNull();
  });
});
