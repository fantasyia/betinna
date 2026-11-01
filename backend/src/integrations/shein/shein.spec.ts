import { createCipheriv, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { vincularNavegador } from '@shared/utils/oauth-navegador';
import { assinarShein, decifrarSecretKey, horaShein } from './shein-assinatura';
import { credenciaisShein } from './shein.client';
import { SheinOrdersService } from './shein-orders.service';

describe('Shein (01/11)', () => {
  it('assinatura: aleatório + base64(hex do HMAC de id&ts&path com segredo+aleatório)', () => {
    const { timestamp, assinatura } = assinarShein(
      'ID1',
      'SEG',
      '/open-api/x',
      1700000000000,
      'Ab3x9',
    );
    const hex = createHmac('sha256', 'SEGAb3x9')
      .update('ID1&1700000000000&/open-api/x')
      .digest('hex');
    expect(timestamp).toBe('1700000000000');
    expect(assinatura).toBe('Ab3x9' + Buffer.from(hex).toString('base64'));
  });

  it('secretKey da loja: decifra AES-128-CBC com os 16 primeiros bytes do segredo do app', () => {
    const appSecret = '0123456789abcdef0123456789abcdef';
    const c = createCipheriv(
      'aes-128-cbc',
      Buffer.from(appSecret).subarray(0, 16),
      Buffer.from('space-station-de'),
    );
    const cifrado = Buffer.concat([c.update('segredo-da-loja'), c.final()]).toString('base64');
    expect(decifrarSecretKey(cifrado, appSecret)).toBe('segredo-da-loja');
  });

  it('hora da Shein é UTC+8 no formato da API', () => {
    expect(horaShein(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01 08:00:00');
  });

  it('credenciais: forma antiga (só o par do app) vira appId/appSecret, loja sem chave', () => {
    expect(credenciaisShein({ openKeyId: ' APP ', secretKey: 'SEG' })).toEqual({
      appId: 'APP',
      appSecret: 'SEG',
    });
    expect(
      credenciaisShein({
        appId: 'APP',
        appSecret: 'S',
        openKeyId: 'LOJA',
        secretKey: 'K',
        supplierId: '9',
      }),
    ).toEqual({ appId: 'APP', appSecret: 'S', openKeyId: 'LOJA', secretKey: 'K', supplierId: '9' });
  });

  it('link de autorização com rota de hash: o state é achado e amarrado ao navegador', () => {
    const res = { cookie: vi.fn() };
    vincularNavegador(
      res as never,
      'https://openapi-sem.sheincorp.com/#/empower?appid=A&redirectUrl=eA%3D%3D&state=abc.def',
    );
    expect(res.cookie).toHaveBeenCalledTimes(1);
  });

  it('lista pagina de 30 em 30 até o total e limita a janela a 48 h', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        count: 31,
        orderList: Array.from({ length: 30 }, (_, i) => ({ orderNo: `P${i}` })),
      })
      .mockResolvedValueOnce({ count: 31, orderList: [{ orderNo: 'P30' }] });
    const svc = new SheinOrdersService({ post } as never);
    const r = await svc.listar('emp1', 200);
    expect(r.total).toBe(31);
    expect(r.pedidos).toHaveLength(31);
    expect(post).toHaveBeenCalledTimes(2);
    const corpo = post.mock.calls[0][2] as { startTime: string; endTime: string; page: number };
    const horas = (Date.parse(corpo.endTime) - Date.parse(corpo.startTime)) / 3_600_000;
    expect(horas).toBe(48);
    expect((post.mock.calls[1][2] as { page: number }).page).toBe(2);
  });
});
