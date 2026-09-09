import { describe, expect, it } from 'vitest';
import { sanitizarTexto } from '@shared/utils/sanitize-pii';

/**
 * PII na MENSAGEM do erro — o caminho que o filtro não cobria.
 *
 * O Sentry foi ligado em produção em 09/09. `sendDefaultPii: false` cuida do que
 * o SDK coleta sozinho, e o `sanitize` cuida dos payloads estruturados
 * (`extra`, `contexts`, breadcrumbs). Nenhum dos dois olhava o texto que o nosso
 * código escreve — e é nele que está o vazamento.
 *
 * O exemplo é do mesmo dia: `DestinatarioInvalidoError` carrega o corpo cru do
 * Evolution, com o telefone dentro, e ia inteiro pro Sentry — que é um terceiro.
 * Numa base com conversa de WhatsApp e telefone em quase todo payload, isso é
 * exportação de base, não observabilidade.
 *
 * ⚠️ Metade destes testes é sobre o que NÃO pode ser tocado. Limpar demais é o
 * outro jeito de estragar: um filtro que come a própria exceção entrega uma
 * lista de nada, e ninguém descobre até o dia de precisar do rastro.
 */
describe('PII dentro de texto corrido', () => {
  it('mascara e-mail no meio da frase', () => {
    const r = sanitizarTexto('Falha ao entregar lead joao@empresa.com.br no passo 3');

    expect(r).not.toContain('joao@empresa.com.br');
    expect(r).toContain('@empresa.com.br'); // domínio fica: ajuda a debugar
    expect(r).toContain('no passo 3');
  });

  it('mascara o telefone do jid do WhatsApp — o caso real de 09/09', () => {
    const r = sanitizarTexto(
      'Destinatário inválido no WhatsApp: HTTP 400 — {"jid":"5511999990000@s.whatsapp.net","exists":false,"number":"5511999990000"}',
    );

    expect(r).not.toContain('5511999990000');
    // A informação que serve pro debug sobrevive.
    expect(r).toContain('Destinatário inválido');
    expect(r).toContain('HTTP 400');
    expect(r).toContain('s.whatsapp.net');
  });

  it('redige valor de chave sensível em JSON embutido', () => {
    const r = sanitizarTexto('payload recusado: {"telefone":"11987654321","cidade":"Sorocaba"}');

    expect(r).not.toContain('11987654321');
    expect(r).toContain('Sorocaba'); // o resto do payload continua legível
  });

  it('mascara CPF e CNPJ com pontuação', () => {
    const r = sanitizarTexto('contato 372.585.458-08 da empresa 16.774.052/0001-55');

    expect(r).not.toContain('372.585.458-08');
    expect(r).not.toContain('16.774.052/0001-55');
  });

  describe('o que NÃO pode ser tocado', () => {
    it('a mensagem e a pilha do erro sobrevivem inteiras', () => {
      const stack =
        "TypeError: Cannot read properties of undefined (reading 'id')\n" +
        '    at PedidoService.enviar (/app/dist/pedidos/pedido.service.js:412:19)';

      expect(sanitizarTexto(stack)).toBe(stack);
    });

    it('id, número de pedido e timestamp passam intactos', () => {
      // Sequência de dígitos solta é id, pedido ou timestamp com muito mais
      // frequência que telefone. Comer isso cega o rastro.
      for (const t of [
        'pedido SB2609YSFQBN / ERP 52 / id 339059294',
        'execucao cmttkj84q005as1brr627ji8w falhou em 2026-09-09T15:16:01.683Z',
        'trace 4bf92f3577b34da6a3ce929d0e0e4736 sample_rand 0.8123456789',
        'conta a pagar 339059437 no valor de 0.73',
      ]) {
        expect(sanitizarTexto(t), t).toBe(t);
      }
    });

    it('a palavra "exception" não vira redação', () => {
      // `exCEPtion` contém `cep`: foi exatamente assim que o filtro do site
      // apagou a exceção inteira, compilando e com teste de unidade verde.
      const t = 'Unhandled exception ao processar recepcao do webhook';

      expect(sanitizarTexto(t)).toBe(t);
    });

    it('texto sem PII nenhum volta idêntico', () => {
      const t = 'Fluxo P2 concluído em 3 passos, nenhum erro';

      expect(sanitizarTexto(t)).toBe(t);
    });
  });
});
