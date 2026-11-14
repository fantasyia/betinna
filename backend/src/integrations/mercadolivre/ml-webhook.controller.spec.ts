import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MLWebhookController } from './ml-webhook.controller';

/**
 * 14/11: as notificações do ML vinham de 152.233.30.x (fora da whitelist antiga)
 * e o tópico `messages` traz o ID da MENSAGEM no `resource` — as duas coisas
 * impediam qualquer pós-venda de entrar pelo webhook.
 */
describe('MLWebhookController', () => {
  let messages: { processarNotificacao: ReturnType<typeof vi.fn> };
  let claims: { obter: ReturnType<typeof vi.fn>; processarClaim: ReturnType<typeof vi.fn> };
  let controller: MLWebhookController;
  const env = {
    get: vi.fn().mockReturnValue('54.88.218.97,152.233.30.0/24'),
    isProduction: true,
  };

  beforeEach(() => {
    messages = { processarNotificacao: vi.fn().mockResolvedValue({ processadas: 1 }) };
    claims = { obter: vi.fn().mockResolvedValue({ id: 1 }), processarClaim: vi.fn() };
    controller = new MLWebhookController(
      env as never,
      { resolverPorUserId: vi.fn().mockResolvedValue('emp-1') } as never,
      {} as never,
      messages as never,
      {} as never,
      claims as never,
      {
        checkAndMarkWebhook: vi.fn().mockResolvedValue({ fresh: true }),
        releaseWebhook: vi.fn().mockResolvedValue(undefined),
      } as never,
    );
  });

  const req = (ip: string) => ({ ip, socket: {} }) as never;

  it('messages com resource = ID da mensagem vai pro processarNotificacao', async () => {
    const r = await controller.receive(req('::ffff:152.233.30.104'), {
      _id: 'n1',
      topic: 'messages',
      resource: '0ce04d2ff5b7489d916c87d0ac7a4bc3',
      user_id: 82495897,
    } as never);

    expect(r).toEqual({ ok: true });
    expect(messages.processarNotificacao).toHaveBeenCalledWith(
      'emp-1',
      '0ce04d2ff5b7489d916c87d0ac7a4bc3',
      '82495897',
    );
  });

  it('IP fora da whitelist continua recusado', async () => {
    const r = await controller.receive(req('8.8.8.8'), {
      _id: 'n2',
      topic: 'messages',
      resource: 'abc',
      user_id: 1,
    } as never);

    expect(r).toEqual({ ok: false });
    expect(messages.processarNotificacao).not.toHaveBeenCalled();
  });

  it('claims seguem pelo ID numérico do resource', async () => {
    await controller.receive(req('54.88.218.97'), {
      _id: 'n3',
      topic: 'claims',
      resource: '/post-purchase/v1/claims/5607771240',
      user_id: 82495897,
    } as never);

    expect(claims.obter).toHaveBeenCalledWith('emp-1', '5607771240');
  });
});
