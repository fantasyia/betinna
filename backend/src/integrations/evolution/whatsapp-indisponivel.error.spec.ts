import { describe, expect, it } from 'vitest';
import { HttpClientError } from '@shared/http/http-client.types';
import { WhatsappIndisponivelError, ehIndisponibilidade } from './whatsapp-indisponivel.error';

/**
 * Classificação de falha de envio: PORTA FECHADA (esperar resolve) × erro de
 * conteúdo/destino (esperar só atrasa o aviso).
 *
 * A regra prática: errar pro lado de "transitório" segura por horas uma
 * mensagem que nunca ia sair, e o lead fica esperando um contato que não vem.
 * Por isso a lista é explícita e o desconhecido cai como permanente.
 */
const httpErr = (status: number, body: unknown) =>
  new HttpClientError(status, body, 'https://evo/message/sendText', 'post', 1);

describe('ehIndisponibilidade', () => {
  it('o caso real de 21/08: 400 com "Connection Closed" no corpo', () => {
    // A instância caiu no meio da conversa e o Evolution respondeu 400 —
    // ele usa 400 pra tudo, então o que decide é o CORPO.
    expect(ehIndisponibilidade(httpErr(400, { message: ['Error: Connection Closed'] }))).toBe(true);
  });

  it('5xx é indisponibilidade: o servidor dizendo que ELE falhou', () => {
    for (const s of [500, 502, 503, 504]) {
      expect(ehIndisponibilidade(httpErr(s, { message: 'boom' }))).toBe(true);
    }
  });

  it('timeout e recusa de conexão contam', () => {
    expect(ehIndisponibilidade(new Error('connect ECONNREFUSED 10.0.0.3:8080'))).toBe(true);
    expect(ehIndisponibilidade(new Error('socket hang up'))).toBe(true);
    expect(ehIndisponibilidade(new Error('The operation was aborted due to timeout'))).toBe(true);
  });

  it('número inexistente NÃO é indisponibilidade — esperar não conserta', () => {
    expect(ehIndisponibilidade(httpErr(400, { message: ['number not exists'] }))).toBe(false);
  });

  it('credencial e instância inexistente também não — é configuração, não queda', () => {
    expect(ehIndisponibilidade(httpErr(401, { message: 'Unauthorized' }))).toBe(false);
    expect(ehIndisponibilidade(httpErr(403, { message: 'Forbidden' }))).toBe(false);
    expect(ehIndisponibilidade(httpErr(404, { message: 'instance not found' }))).toBe(false);
  });

  it('erro desconhecido cai como PERMANENTE (o lado seguro de errar)', () => {
    expect(ehIndisponibilidade(new Error('algo que ninguém mapeou'))).toBe(false);
    expect(ehIndisponibilidade(httpErr(422, { message: 'mídia recusada' }))).toBe(false);
  });

  it('o próprio erro tipado é reconhecido (re-classificação não perde a marca)', () => {
    expect(ehIndisponibilidade(new WhatsappIndisponivelError('HTTP 400 — Connection Closed'))).toBe(
      true,
    );
  });
});
