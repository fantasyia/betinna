import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyClientService } from './tiny-client.service';
import { HttpClientError } from '@shared/http/http-client.types';

/**
 * 429 é a única falha que a ESCRITA re-tenta.
 *
 * O resto da escrita não re-tenta de propósito: timeout e 5xx podem ter sido
 * processados do outro lado, e repetir criaria pedido duplicado. 429 não tem
 * essa dúvida — o servidor recusou, nada rodou.
 *
 * O caso real (03/09): subir proposta pro ERP morreu com
 * `POST /contatos HTTP 429` logo depois de uma varredura de produtos, e o
 * usuário viu "falhou" numa ação que só precisava de três segundos.
 */
const montar = (respostas: Array<{ erro?: HttpClientError; dados?: unknown }>) => {
  let i = 0;
  const chamada = vi.fn().mockImplementation(() => {
    const r = respostas[Math.min(i++, respostas.length - 1)];
    if (r.erro) return Promise.reject(r.erro);
    return Promise.resolve({ data: r.dados ?? { ok: true }, headers: {} });
  });
  const http = { get: chamada, post: chamada, put: chamada };
  const svc = new TinyClientService(
    { get: (k: string) => (k === 'TINY_BASE_URL' ? 'https://api' : 5000) } as never,
    http as never,
    { getAccessToken: vi.fn().mockResolvedValue({ accessToken: 'tok' }) } as never,
  );
  return { svc, chamada };
};

const erro = (status: number) => new HttpClientError(status, {}, 'https://api/x', 'post', 1);

describe('TinyClientService — rate limit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST que toma 429 re-tenta e passa na segunda — o usuário não vê erro', async () => {
    const { svc, chamada } = montar([{ erro: erro(429) }, { dados: { id: 7 } }]);

    const r = await svc.post('emp-1', '/contatos', { nome: 'x' });

    expect(r).toEqual({ id: 7 });
    expect(chamada).toHaveBeenCalledTimes(2);
  }, 20000);

  it('429 insistente estoura depois das tentativas — não fica em loop', async () => {
    const { svc, chamada } = montar([{ erro: erro(429) }]);

    await expect(svc.post('emp-1', '/contatos', {})).rejects.toThrow(/429/);
    expect(chamada).toHaveBeenCalledTimes(3);
  }, 30000);

  it('500 na ESCRITA não re-tenta — pode ter sido processado, e repetir duplicaria', async () => {
    const { svc, chamada } = montar([{ erro: erro(500) }, { dados: { id: 9 } }]);

    await expect(svc.post('emp-1', '/pedidos', {})).rejects.toThrow(/500/);
    expect(chamada).toHaveBeenCalledTimes(1);
  });

  it('404 sobe na hora, sem espera', async () => {
    const { svc, chamada } = montar([{ erro: erro(404) }]);

    await expect(svc.get('emp-1', '/produtos/1')).rejects.toThrow(/404/);
    expect(chamada).toHaveBeenCalledTimes(1);
  });
});
