import { describe, expect, it } from 'vitest';
import { criarSchema } from './notificacoes.dto';

/**
 * O `link` da notificacao vira `navigate(n.link)` no sino. Sem amarrar o
 * formato, quem cria a notificacao escolhe pra onde o clique leva — inclusive
 * pra FORA do app.
 *
 * `//host` e `/\host` sao os dois que enganam: o navegador le os dois como
 * protocol-relative e sai da origem, mas os dois "parecem" caminho interno
 * porque comecam com barra. E a mesma classe do advisory do react-router.
 */
describe('criarSchema.link — so caminho interno', () => {
  const parse = (link: string) =>
    criarSchema.safeParse({
      usuarioId: 'u1',
      tipo: 'GENERICO',
      titulo: 'titulo',
      mensagem: 'mensagem',
      link,
    });

  it.each([
    ['/leads/abc123', 'rota simples'],
    ['/pedidos?highlight=1', 'com querystring'],
    ['/', 'raiz'],
  ])('aceita %s (%s)', (link) => {
    expect(parse(link).success).toBe(true);
  });

  it.each([
    ['//evil.com', 'protocol-relative com duas barras'],
    ['/\\evil.com', 'barra + contrabarra — o bypass do advisory'],
    ['\\\\evil.com', 'duas contrabarras'],
    ['https://evil.com', 'URL absoluta'],
    ['javascript:alert(1)', 'esquema javascript'],
    ['leads/abc', 'sem barra inicial'],
  ])('recusa %s (%s)', (link) => {
    expect(parse(link).success).toBe(false);
  });

  it('link ausente continua valido — a maioria das notificacoes nao tem link', () => {
    const r = criarSchema.safeParse({
      usuarioId: 'u1',
      tipo: 'GENERICO',
      titulo: 'titulo',
      mensagem: 'mensagem',
    });

    expect(r.success).toBe(true);
  });
});
