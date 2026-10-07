import { describe, expect, it, vi } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { AsaasClient, EVENTOS_WEBHOOK, ambienteDaChave, lerTaxas } from './asaas.client';

const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

describe('AsaasClient', () => {
  it('ambiente sai do prefixo da chave; chave sem prefixo é recusada', () => {
    expect(ambienteDaChave('$aact_hmlg_abc')).toBe('sandbox');
    expect(ambienteDaChave('$aact_prod_abc')).toBe('producao');
    expect(ambienteDaChave('abc')).toBeNull();
    expect(() => new AsaasClient('chave-qualquer')).toThrow(IntegrationException);
  });

  it('sandbox vai pro host de sandbox, com access_token (não Bearer)', async () => {
    const f = vi.fn().mockResolvedValue(resposta(200, { balance: 10 }));
    await new AsaasClient('$aact_hmlg_x', f).saldo();
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api-sandbox.asaas.com/v3/finance/balance');
    expect(init.headers.access_token).toBe('$aact_hmlg_x');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('401 vira mensagem clara; erro do Asaas traz a descrição dele (sem vazar a chave)', async () => {
    const a = new AsaasClient('$aact_prod_segredo', vi.fn().mockResolvedValue(resposta(401, {})));
    await expect(a.saldo()).rejects.toThrow(/recusada/);
    const b = new AsaasClient(
      '$aact_prod_segredo',
      vi.fn().mockResolvedValue(resposta(400, { errors: [{ description: 'URL inválida' }] })),
    );
    const err = (await b.saldo().catch((e: unknown) => e)) as Error;
    expect(err.message).toBe('URL inválida');
    expect(err.message).not.toContain('segredo');
  });

  it('aviso: cria (POST) sem id, atualiza (PUT) com id; eventos de pago incluídos', async () => {
    // Resposta nova a cada chamada (o corpo de uma Response só se lê uma vez).
    const f = vi
      .fn()
      .mockImplementation(async () =>
        resposta(200, { id: 'wh_1', url: 'u', enabled: true, interrupted: false }),
      );
    const a = new AsaasClient('$aact_hmlg_x', f);
    await a.salvarWebhook({ url: 'https://api/x', authToken: 't'.repeat(64), email: 'leo@x.com' });
    await a.salvarWebhook({ url: 'https://api/x', authToken: 't'.repeat(64) }, 'wh_1');
    expect(f.mock.calls[0][0]).toMatch(/\/webhooks$/);
    expect(f.mock.calls[0][1].method).toBe('POST');
    expect(f.mock.calls[1][0]).toMatch(/\/webhooks\/wh_1$/);
    expect(f.mock.calls[1][1].method).toBe('PUT');
    const corpo = JSON.parse(f.mock.calls[0][1].body);
    expect(corpo).toMatchObject({
      enabled: true,
      interrupted: false,
      sendType: 'SEQUENTIALLY',
      email: 'leo@x.com',
    });
    expect(EVENTOS_WEBHOOK).toEqual(
      expect.arrayContaining(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']),
    );
  });

  it('taxas: usa o desconto promocional só enquanto ele vale', () => {
    const fees = {
      payment: {
        creditCard: {
          operationValue: 0.49,
          oneInstallmentPercentage: 2.99,
          upToSixInstallmentsPercentage: 3.49,
          upToTwelveInstallmentsPercentage: 3.99,
          discountOneInstallmentPercentage: 1.99,
          discountUpToSixInstallmentsPercentage: 2.49,
          discountUpToTwelveInstallmentsPercentage: 2.99,
          discountExpiration: '2026-12-04 00:00:00',
        },
        pix: {
          fixedFeeValue: null,
          percentageFee: 0.99,
          minimumFeeValue: 0.29,
          maximumFeeValue: 1.99,
        },
      },
    };
    const antes = lerTaxas(fees, new Date('2026-10-07T12:00:00Z'));
    expect(antes.cartao).toEqual({ fixa: 0.49, umaVez: 1.99, ateSeis: 2.49, ateDoze: 2.99 });
    const depois = lerTaxas(fees, new Date('2027-01-01T12:00:00Z'));
    expect(depois.cartao).toEqual({ fixa: 0.49, umaVez: 2.99, ateSeis: 3.49, ateDoze: 3.99 });
    expect(antes.pix).toEqual({ percentual: 0.99, fixa: null, minima: 0.29, maxima: 1.99 });
  });
});
