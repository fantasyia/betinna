import { describe, expect, it } from 'vitest';
import { limparSpan, limparTransacao } from './sentry';
import { chaveAntiSpam } from '@modules/mullerbot/muller-whatsapp.service';

/**
 * PII em SPAN e TRANSAÇÃO — o caminho que o `beforeSend` não cobre.
 *
 * No SDK do Sentry o `beforeSend` roda só em evento de ERRO. Transação passa
 * pelo `beforeSendTransaction` e span pelo `beforeSendSpan`, e nenhum dos dois
 * existia: todo o filtro construído desde 09/09 ficava fora da telemetria de
 * desempenho. Medido em 08/10: ~760 spans/semana com o JID do WhatsApp cru na
 * descrição — a auto-instrumentação do Redis escreve o comando, chave inclusa,
 * e a chave do anti-spam levava o telefone. E o IP do visitante ia cru em
 * `client.address`, apesar do `sendDefaultPii: false`.
 *
 * Estes testes levam PII DE PROPÓSITO no span: é o único jeito de provar que o
 * filtro roda ali (teste sem PII passa com filtro nenhum).
 */

const JID = '5511999990000@s.whatsapp.net';
const SEGREDO_TINY = 'segredo-do-tiny-abc123';

type Span = Parameters<typeof limparSpan>[0];
type Transacao = Parameters<typeof limparTransacao>[0];

function span(over: Partial<Span>): Span {
  return {
    span_id: 'a1b2c3d4e5f60718',
    trace_id: '0123456789abcdef0123456789abcdef',
    start_timestamp: 1760000000.123,
    data: {},
    ...over,
  } as Span;
}

describe('span', () => {
  it('telefone do JID some da descrição do comando do Redis — o caso real de 08/10', () => {
    const s = limparSpan(
      span({ op: 'db.redis', description: `EVAL local n... 1 bot:spam:emp-1:${JID} 60` }),
    );
    expect(s.description).not.toContain('5511999990000');
    // O comando continua legível. (O `sanitizarTexto` lê `chave:...@s.whatsapp.net`
    // como e-mail e mascara o prefixo junto — exagero aceito: a regra é a calibrada
    // de 09/2026, e com o hash na origem essa chave não carrega mais JID.)
    expect(s.description).toMatch(/^EVAL local n\.\.\. 1 .* 60$/);
  });

  it('IP do visitante sai do span', () => {
    const s = limparSpan(
      span({ data: { 'client.address': '187.10.20.30', 'http.client_ip': '187.10.20.30' } }),
    );
    expect(s.data).not.toHaveProperty('client.address');
    expect(s.data).not.toHaveProperty('http.client_ip');
  });

  it('segredo do webhook do Tiny some do caminho guardado no span', () => {
    const caminho = `/api/v1/webhooks/tiny/${SEGREDO_TINY}/pedido`;
    const s = limparSpan(
      span({
        description: `POST ${caminho}`,
        data: { 'url.full': `https://api.x.test${caminho}`, 'http.target': caminho },
      }),
    );
    expect(JSON.stringify(s)).not.toContain(SEGREDO_TINY);
    expect(s.data['http.target']).toBe('/api/v1/webhooks/tiny/[REDACTED]/pedido');
  });

  it('e-mail em dado do span (SQL com parâmetro) é mascarado', () => {
    const s = limparSpan(
      span({ data: { 'db.statement': "SELECT * FROM lead WHERE email = 'joao@empresa.com.br'" } }),
    );
    expect(JSON.stringify(s)).not.toContain('joao@empresa.com.br');
  });

  describe('o que NÃO pode ser tocado', () => {
    it('ids, trace, operação e SQL comum chegam inteiros', () => {
      const original = span({
        op: 'db',
        description: 'SELECT "Produto"."id" FROM "Produto" WHERE "empresaId" = $1 LIMIT $2',
        data: { 'db.system': 'postgresql', 'sentry.sample_rand': 0.4821937465 },
      });
      const s = limparSpan(structuredClone(original));
      expect(s).toEqual(original);
    });
  });
});

describe('transação', () => {
  function transacao(over: Partial<Transacao>): Transacao {
    return { type: 'transaction', ...over } as Transacao;
  }

  it('limpa nome, spans filhos, trace raiz, usuário e headers', () => {
    const t = limparTransacao(
      transacao({
        transaction: `POST /api/v1/webhooks/tiny/${SEGREDO_TINY}/pedido`,
        spans: [span({ description: `GET bot:spam:emp-1:${JID}` })],
        contexts: {
          trace: {
            trace_id: '0123456789abcdef0123456789abcdef',
            span_id: 'a1b2c3d4e5f60718',
            data: { 'client.address': '187.10.20.30', 'http.route': '/pedidos/:id' },
          },
        },
        user: { id: 'u-1', ip_address: '187.10.20.30', email: 'joao@empresa.com.br' },
        request: {
          url: `https://api.x.test/api/v1/webhooks/tiny/${SEGREDO_TINY}/pedido`,
          headers: { authorization: 'Bearer abc', cookie: 'sid=1' },
        },
      }),
    );

    const tudo = JSON.stringify(t);
    expect(tudo).not.toContain(SEGREDO_TINY);
    expect(tudo).not.toContain('5511999990000');
    expect(tudo).not.toContain('187.10.20.30');
    expect(tudo).not.toContain('joao@empresa.com.br');
    expect(tudo).not.toContain('Bearer abc');
    // O que serve pra ler a tela de Performance fica.
    expect(t.contexts?.trace?.data?.['http.route']).toBe('/pedidos/:id');
    expect(t.contexts?.trace?.trace_id).toBe('0123456789abcdef0123456789abcdef');
    expect(t.user?.id).toBe('u-1');
  });
});

describe('na origem: a chave do anti-spam não leva o telefone', () => {
  it('mesmo peer → mesma chave; peers diferentes → chaves diferentes; sem dígito do telefone', () => {
    const a = chaveAntiSpam('emp-1', JID);
    expect(a).toBe(chaveAntiSpam('emp-1', JID));
    expect(a).not.toBe(chaveAntiSpam('emp-1', '5511888880000@s.whatsapp.net'));
    expect(a).not.toBe(chaveAntiSpam('emp-2', JID));
    expect(a).not.toContain('5511999990000');
    expect(a.startsWith('bot:spam:emp-1:')).toBe(true);
  });
});
