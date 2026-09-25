import { describe, expect, it } from 'vitest';
import { pediuOLinkDeNovo, urlsDoTexto } from './conversar-ia.service';

/**
 * P2 da Bateria 3 (14/09/2026) — o caso A8.
 *
 * O lead volta a falar, o C1 dispara de novo e entrega o link da calculadora
 * com a URL IDÊNTICA. O estado que diz "já entreguei" existe (tag
 * `calculadora-enviada`, etapa "Calculadora enviada", `desfecho_consultivo`
 * preenchido) — a IA é que não o consulta.
 *
 * Decisão do Léo: em vez de reenviar, **retomar de onde parou** (opção A).
 * O motor detecta a repetição olhando as mensagens OUTBOUND da conversa e
 * REGERA com essa informação — não reescreve a fala da IA.
 *
 * ⚠️ Aqui ficam as peças PURAS da guarda. O caminho completo (regerar e trocar
 * a resposta) é exercitado em `conversar-ia.service.spec.ts`, no describe
 * "link repetido — o caminho da regeração".
 *
 * 🔴 Essa frase já esteve aqui e era FALSA por semanas: o mock de `message` no
 * spec do turno não tinha `findFirst`, a consulta estourava, caía no catch
 * best-effort e a regeração NUNCA rodava. Dois docblocks afirmavam cobertura
 * que não existia, e a afirmação foi copiada de um pro outro sem ninguém medir.
 * Se você for repetir uma frase dessas, rode a mutação antes.
 */

describe('urlsDoTexto — o que conta como "o mesmo link"', () => {
  it('acha a URL da calculadora com query e âncora (o formato que reprovou)', () => {
    const texto =
      'Prontinho! Segue: https://somatecblocking.com.br/protecao-comercial' +
      '?contexto=comercio&corrente=63&tensao=220V&origem=disjuntor#calculadora';
    expect(urlsDoTexto(texto)).toEqual([
      'https://somatecblocking.com.br/protecao-comercial?contexto=comercio&corrente=63&tensao=220V&origem=disjuntor#calculadora',
    ]);
  });

  it('não engole a pontuação do fim da frase — senão a comparação nunca casa', () => {
    expect(urlsDoTexto('olha aqui: https://site.com.br/x?a=1.')).toEqual([
      'https://site.com.br/x?a=1',
    ]);
    expect(urlsDoTexto('é esse https://site.com.br/y, dá uma olhada')).toEqual([
      'https://site.com.br/y',
    ]);
  });

  /**
   * 🔴 Reteste de 25/09 (A8-atrasado, 2 links e a sequência repetida): a IA
   * cola os balões com "|||" SEM espaço, e a URL procurada virava
   * "…#calculadora|||Se" — nunca casava com a mensagem gravada, e as quatro
   * guardas (resposta, abertura, reserva, regeração) deixavam o link passar.
   * Os specs anteriores passavam porque o link ficava no FIM do texto.
   */
  it('para no separador de balão "|||" colado na URL', () => {
    const texto =
      'Segue: https://somatecblocking.com.br/protecao-comercial?corrente=63#calculadora' +
      '|||Se surgir qualquer dúvida, me chama!';
    expect(urlsDoTexto(texto)).toEqual([
      'https://somatecblocking.com.br/protecao-comercial?corrente=63#calculadora',
    ]);
    expect(urlsDoTexto('olha https://site.com.br/x|||e mais https://site.com.br/y|||fim')).toEqual([
      'https://site.com.br/x',
      'https://site.com.br/y',
    ]);
  });

  it('acha mais de um link e ignora texto sem link', () => {
    expect(urlsDoTexto('a https://a.com e b http://b.com')).toHaveLength(2);
    expect(urlsDoTexto('sem link nenhum aqui')).toEqual([]);
  });
});

describe('pediuOLinkDeNovo — quando REENVIAR é o certo', () => {
  it('pedido explícito desliga a guarda', () => {
    for (const frase of [
      'manda de novo por favor',
      'pode reenviar o link?',
      'me envia novamente',
      'perdi o link',
      'não recebi o link',
      'apaguei a mensagem com o link',
      'qual era o link mesmo?',
      'cadê o link',
    ]) {
      expect(pediuOLinkDeNovo(frase), frase).toBe(true);
    }
  });

  it('conversa normal NÃO conta como pedido — aí a guarda vale', () => {
    for (const frase of [
      'consegui usar, obrigado',
      'a corrente é 63A',
      'vou ver com meu eletricista',
      'esse produto protege o que?',
    ]) {
      expect(pediuOLinkDeNovo(frase), frase).toBe(false);
    }
  });

  it('funciona sem acento (é como o lead digita no WhatsApp)', () => {
    expect(pediuOLinkDeNovo('nao achei o link')).toBe(true);
    expect(pediuOLinkDeNovo('cade o link')).toBe(true);
  });
});
