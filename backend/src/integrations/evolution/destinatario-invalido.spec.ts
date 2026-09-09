import { describe, expect, it } from 'vitest';
import {
  ehDestinatarioInvalido,
  ehIndisponibilidade,
  numeroInvalidoDoErro,
} from './whatsapp-indisponivel.error';
import { HttpClientError } from '@shared/http/http-client.types';

/**
 * "Número não existe" tem que se separar de "porta fechada" — e o Evolution
 * manda as duas coisas no MESMO envelope: HTTP 400.
 *
 * Errar pra cada lado custa uma coisa diferente, e por isso metade destes
 * testes é sobre o que NÃO pode ser classificado como inválido:
 *  - dar por inválido o que era transitório → o motor PULA o envio e segue, e o
 *    cliente nunca recebe a mensagem. Sem retry, sem segunda chance.
 *  - dar por transitório o que era inválido → reagenda pra sempre (o defeito de
 *    09/09, ao contrário).
 */
const erro400 = (body: unknown) =>
  new HttpClientError(400, body, 'https://evo.local/message/sendText', 'post', 1);

describe('destinatário inválido no WhatsApp', () => {
  it('pega o corpo REAL que derrubou o fluxo do pedido em 09/09', () => {
    expect(
      ehDestinatarioInvalido(
        erro400({
          message: [
            { jid: '5511999990000@s.whatsapp.net', exists: false, number: '5511999990000' },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('pega as frases que variam com a versão do Evolution', () => {
    for (const m of [
      'number does not exist',
      'Number not exists',
      'this number does not exist on whatsapp',
      'invalid jid',
    ]) {
      expect(ehDestinatarioInvalido(new Error(m)), m).toBe(true);
    }
  });

  it('`exists: true` NÃO é destinatário inválido', () => {
    // O mesmo formato de corpo, com a resposta oposta. Casar por "exists" solto
    // classificaria o número BOM como inexistente.
    expect(
      ehDestinatarioInvalido(
        erro400({ message: [{ jid: '5511997524483@s.whatsapp.net', exists: true }] }),
      ),
    ).toBe(false);
  });

  it('instância caída continua sendo INDISPONIBILIDADE, não destinatário', () => {
    // É o mesmo HTTP 400. Se este caso virasse "inválido", toda queda do
    // Evolution passaria a pular envios em silêncio em vez de reagendar.
    const queda = erro400({ message: 'Error: Connection Closed' });

    expect(ehDestinatarioInvalido(queda)).toBe(false);
    expect(ehIndisponibilidade(queda)).toBe(true);
  });

  it('timeout e 5xx seguem transitórios', () => {
    expect(ehDestinatarioInvalido(new Error('socket hang up'))).toBe(false);
    expect(ehDestinatarioInvalido(erro400({ message: 'timeout' }))).toBe(false);
    expect(
      ehDestinatarioInvalido(
        new HttpClientError(503, {}, 'https://evo.local/message/sendText', 'post', 1),
      ),
    ).toBe(false);
  });

  it('erro desconhecido NÃO é dado por inválido', () => {
    // Na dúvida cai no caminho de falha normal, que ao menos tenta de novo —
    // pular o envio é a decisão irreversível das duas.
    expect(ehDestinatarioInvalido(new Error('alguma coisa deu errado'))).toBe(false);
    expect(ehDestinatarioInvalido(erro400({ message: 'media upload failed' }))).toBe(false);
    expect(ehDestinatarioInvalido(undefined)).toBe(false);
  });
});

describe('o número que o provedor recusou', () => {
  it('sai do corpo do erro, não do que a gente mandou', () => {
    // Quem sabe qual endereço foi recusado é quem respondeu — e o normalizador
    // já mexeu no número que saiu daqui.
    expect(
      numeroInvalidoDoErro(
        erro400({
          message: [
            { jid: '5511999990000@s.whatsapp.net', exists: false, number: '5511999990000' },
          ],
        }),
      ),
    ).toBe('5511999990000');
  });

  it('cai pro jid quando não vem o campo `number`', () => {
    expect(
      numeroInvalidoDoErro(
        erro400({ message: [{ jid: '5511997524483@s.whatsapp.net', exists: false }] }),
      ),
    ).toBe('5511997524483');
  });

  it('sem número no corpo, devolve null — e ninguém é carimbado', () => {
    // Carimbar o contato errado como "sem WhatsApp" é pior que não carimbar.
    expect(numeroInvalidoDoErro(new Error('number does not exist'))).toBeNull();
    expect(numeroInvalidoDoErro(erro400({ message: 'invalid number' }))).toBeNull();
  });
});
