import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ShopeeWebhookController } from './shopee-webhook.controller';

const URL = 'https://api.ribelt.com.br/api/v1/webhooks/shopee';

function montar(env: Record<string, string>) {
  const chat = { processarConversation: vi.fn().mockResolvedValue({ processadas: 1 }) };
  const ctrl = new ShopeeWebhookController(
    { get: (k: string) => env[k] ?? '', isProduction: true } as never,
    { resolverPorShopId: vi.fn().mockResolvedValue('emp1') } as never,
    chat as never,
    {} as never,
    {} as never,
    {} as never,
    { checkAndMarkWebhook: vi.fn().mockResolvedValue({ fresh: true }) } as never,
  );
  return { ctrl, chat };
}

function push(body: object, chave: string) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', chave).update(`${URL}|${raw}`, 'utf8').digest('hex');
  const req = {
    rawBody: Buffer.from(raw),
    headers: { host: 'api.ribelt.com.br', 'x-forwarded-proto': 'https' },
    originalUrl: '/api/v1/webhooks/shopee',
  };
  return [req, sig, body] as const;
}

const CHAT = {
  code: 10,
  shop_id: 327263189,
  timestamp: Math.floor(Date.now() / 1000),
  data: { type: 'message', content: { conversation_id: '1405668769477788930' } },
};

describe('Webhook Shopee (28/10)', () => {
  it('assinatura com a Live Push Partner Key vale, e o chat (code 10) busca a conversa', async () => {
    const { ctrl, chat } = montar({
      SHOPEE_PARTNER_ID: '1',
      SHOPEE_PARTNER_KEY: 'chave-api',
      SHOPEE_PUSH_PARTNER_KEY: 'chave-push',
    });
    const [req, sig, body] = push(CHAT, 'chave-push');
    expect(await ctrl.receive(req as never, sig, body as never)).toEqual({ ok: true });
    expect(chat.processarConversation).toHaveBeenCalledWith('emp1', '1405668769477788930');
  });

  it('assinatura inválida responde 200 sem processar (o teste da Shopee exige 2xx)', async () => {
    const { ctrl, chat } = montar({ SHOPEE_PARTNER_ID: '1', SHOPEE_PARTNER_KEY: 'chave-api' });
    const [req, , body] = push(CHAT, 'chave-api');
    expect(await ctrl.receive(req as never, 'assinatura-falsa', body as never)).toEqual({
      ok: false,
    });
    expect(chat.processarConversation).not.toHaveBeenCalled();
  });
});
