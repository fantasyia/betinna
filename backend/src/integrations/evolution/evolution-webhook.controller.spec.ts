import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { EvolutionWebhookController } from './evolution-webhook.controller';
import { EvolutionService } from './evolution.service';

const API_KEY = 'test-api-key';
const TOKEN_OK = EvolutionService.webhookToken(API_KEY);

const makeEnv = () => ({ get: vi.fn(() => API_KEY) });
const makeInbound = () => ({ processarEvento: vi.fn().mockResolvedValue(undefined) });
const makeAntiReplay = (fresh = true) => ({
  checkAndMarkWebhook: vi.fn().mockResolvedValue({ fresh, signatureHash: 'h' }),
});

function makeController(antiReplayFresh = true) {
  const env = makeEnv();
  const inbound = makeInbound();
  const antiReplay = makeAntiReplay(antiReplayFresh);
  const ctrl = new EvolutionWebhookController(env as never, inbound as never, antiReplay as never);
  return { ctrl, inbound, antiReplay };
}

const msgBody = (id: string, instance = 'emp_1') => ({
  event: 'messages.upsert',
  instance,
  data: { messages: [{ key: { id }, message: { conversation: 'oi' } }] },
});

describe('EvolutionWebhookController.receber', () => {
  beforeEach(() => vi.clearAllMocks());

  it('RECUSA token inválido e NÃO processa nada', async () => {
    const { ctrl, inbound } = makeController();
    await expect(ctrl.receber('token-forjado', msgBody('m1'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(inbound.processarEvento).not.toHaveBeenCalled();
  });

  it('RECUSA token vazio', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.receber('', msgBody('m1'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('aceita token válido e processa a mensagem nova', async () => {
    const { ctrl, inbound, antiReplay } = makeController();
    const r = await ctrl.receber(TOKEN_OK, msgBody('m1'));
    expect(r).toEqual({ ok: true });
    expect(antiReplay.checkAndMarkWebhook).toHaveBeenCalledWith('evolution', 'emp_1:m1', undefined);
    expect(inbound.processarEvento).toHaveBeenCalledTimes(1);
  });

  it('REPLAY: mensagem repetida (anti-replay fresh=false) é ACK sem reprocessar', async () => {
    const { ctrl, inbound } = makeController(false); // anti-replay diz "já vi"
    const r = await ctrl.receber(TOKEN_OK, msgBody('m1'));
    expect(r).toEqual({ ok: true });
    expect(inbound.processarEvento).not.toHaveBeenCalled();
  });

  it('evento sem id (connection.update) não passa por anti-replay e é processado', async () => {
    const { ctrl, inbound, antiReplay } = makeController();
    await ctrl.receber(TOKEN_OK, {
      event: 'connection.update',
      instance: 'emp_1',
      data: { state: 'open' },
    });
    expect(antiReplay.checkAndMarkWebhook).not.toHaveBeenCalled();
    expect(inbound.processarEvento).toHaveBeenCalledTimes(1);
  });
});
