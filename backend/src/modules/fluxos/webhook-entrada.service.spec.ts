import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import { NotFoundException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { WebhookSignatureUtil } from '@shared/http/webhook-signature.util';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { WebhookEntradaService, conteudoAssinado } from './webhook-entrada.service';

const user: AuthenticatedUser = {
  id: 'u',
  email: 'd@x.com',
  nome: 'D',
  role: 'DIRECTOR' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
};
const SECRET = '11'.repeat(32); // 64 hex

const makePrisma = () => ({
  webhookEntrada: {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn(),
  },
  webhookRecebimento: { create: vi.fn().mockResolvedValue({ id: 'r1' }) },
});
const makeBus = () => ({ disparar: vi.fn() });
const makeRedis = () => ({ incr: vi.fn().mockResolvedValue(1), client: { expire: vi.fn() } });
const makeAntiReplay = () => ({
  checkAndMarkWebhook: vi.fn().mockResolvedValue({ fresh: true, signatureHash: 'h' }),
});

/** Monta um input de receber com assinatura HMAC válida (timestamp + corpo) pro secret. */
function receberValido(payload: unknown, secret = SECRET, over: Record<string, unknown> = {}) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    token: 'tok',
    rawBody,
    timestamp,
    signature: WebhookSignatureUtil.signHmacSha256(conteudoAssinado(timestamp, rawBody), secret),
    ...over,
  };
}

describe('WebhookEntradaService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;
  let redis: ReturnType<typeof makeRedis>;
  let antiReplay: ReturnType<typeof makeAntiReplay>;
  let svc: WebhookEntradaService;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
    redis = makeRedis();
    antiReplay = makeAntiReplay();
    svc = new WebhookEntradaService(
      prisma as never,
      bus as never,
      redis as never,
      antiReplay as never,
    );
  });

  const whAtivo = { id: 'w1', empresaId: 'emp-1', nome: 'h', ativo: true, secret: SECRET };

  it('criar gera token + secret (secret mostrado 1x)', async () => {
    prisma.webhookEntrada.create.mockImplementation(
      (a: { data: { nome: string; token: string } }) =>
        Promise.resolve({ id: 'w1', nome: a.data.nome, token: a.data.token }),
    );
    const r = await svc.criar(user, 'Meu hook');
    expect(r.token.length).toBeGreaterThan(20);
    expect(r.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('listar NUNCA seleciona o secret', async () => {
    await svc.listar(user);
    const sel = prisma.webhookEntrada.findMany.mock.calls[0][0].select;
    expect(sel.secret).toBeUndefined();
    expect(sel.token).toBe(true);
  });

  it('processar com HMAC válido dispara WEBHOOK_RECEBIDO com o payload parseado', async () => {
    prisma.webhookEntrada.findUnique.mockResolvedValue(whAtivo);
    await svc.processar(receberValido({ x: 1 }));
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'WEBHOOK_RECEBIDO',
      expect.objectContaining({ webhookId: 'w1', payload: { x: 1 } }),
    );
  });

  it('assinatura inválida → 401 uniforme, não dispara', async () => {
    prisma.webhookEntrada.findUnique.mockResolvedValue(whAtivo);
    const input = { ...receberValido({ x: 1 }), signature: 'deadbeef' };
    await expect(svc.processar(input)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  // Auditoria 29/09/2026: a hora entra na assinatura — sem ela, o mesmo POST
  // capturado valia pra sempre.
  it('sem timestamp → 401, mesmo com a assinatura antiga (só do corpo) correta', async () => {
    prisma.webhookEntrada.findUnique.mockResolvedValue(whAtivo);
    const rawBody = Buffer.from(JSON.stringify({ x: 1 }));
    const input = {
      token: 'tok',
      rawBody,
      signature: WebhookSignatureUtil.signHmacSha256(rawBody, SECRET),
    };
    await expect(svc.processar(input)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('timestamp trocado depois de assinado → 401 (a hora está dentro do HMAC)', async () => {
    prisma.webhookEntrada.findUnique.mockResolvedValue(whAtivo);
    const valido = receberValido({ x: 1 });
    const input = { ...valido, timestamp: String(Number(valido.timestamp) + 60) };
    await expect(svc.processar(input)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('passa o timestamp assinado pro anti-replay (que recusa fora de ±5 min)', async () => {
    prisma.webhookEntrada.findUnique.mockResolvedValue(whAtivo);
    const input = receberValido({ x: 1 });
    await svc.processar(input);
    expect(antiReplay.checkAndMarkWebhook).toHaveBeenCalledWith(
      'fluxo',
      input.signature,
      input.timestamp,
    );
  });

  it('token inexistente → 401 uniforme (não revela existência), não dispara', async () => {
    prisma.webhookEntrada.findUnique.mockResolvedValue(null);
    await expect(svc.processar(receberValido({ x: 1 }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('anti-replay (fresh=false) → ACK sem disparar', async () => {
    prisma.webhookEntrada.findUnique.mockResolvedValue(whAtivo);
    antiReplay.checkAndMarkWebhook.mockResolvedValue({ fresh: false, signatureHash: 'h' });
    const r = await svc.processar(receberValido({ x: 1 }));
    expect(r).toEqual({ ok: true });
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('idempotência: Idempotency-Key repetida (P2002) → ACK sem disparar', async () => {
    prisma.webhookEntrada.findUnique.mockResolvedValue(whAtivo);
    prisma.webhookRecebimento.create.mockRejectedValue({ code: 'P2002' });
    const r = await svc.processar(receberValido({ x: 1 }, SECRET, { idempotencyKey: 'k1' }));
    expect(r).toEqual({ ok: true });
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('rate-limit por token estourado → 429, sem tocar o banco', async () => {
    redis.incr.mockResolvedValue(301);
    await expect(svc.processar(receberValido({ x: 1 }))).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
    });
    expect(prisma.webhookEntrada.findUnique).not.toHaveBeenCalled();
  });

  it('rate-limit fail-open: Redis fora → processa normalmente', async () => {
    redis.incr.mockRejectedValue(new Error('redis down'));
    prisma.webhookEntrada.findUnique.mockResolvedValue(whAtivo);
    await svc.processar(receberValido({ x: 1 }));
    expect(bus.disparar).toHaveBeenCalled();
  });

  it('rotacionarSecret gera novo secret; 404 quando não existe', async () => {
    const r = await svc.rotacionarSecret(user, 'w1');
    expect(r.secret).toMatch(/^[0-9a-f]{64}$/);
    prisma.webhookEntrada.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.rotacionarSecret(user, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
