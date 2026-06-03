import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import { NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { WebhookEntradaService } from './webhook-entrada.service';

const user: AuthenticatedUser = {
  id: 'u',
  email: 'd@x.com',
  nome: 'D',
  role: 'DIRECTOR' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
};
const makePrisma = () => ({
  webhookEntrada: {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn(),
    findUnique: vi.fn(),
  },
});
const makeBus = () => ({ disparar: vi.fn() });

describe('WebhookEntradaService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;
  let svc: WebhookEntradaService;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
    svc = new WebhookEntradaService(prisma as never, bus as never);
  });

  it('criar gera token aleatório', async () => {
    prisma.webhookEntrada.create.mockImplementation(
      (a: { data: { nome: string; token: string } }) =>
        Promise.resolve({ id: 'w1', nome: a.data.nome, token: a.data.token }),
    );
    const r = await svc.criar(user, 'Meu hook');
    expect(r.token.length).toBeGreaterThan(20);
  });

  it('processar dispara WEBHOOK_RECEBIDO com o payload', async () => {
    prisma.webhookEntrada.findUnique.mockResolvedValue({
      id: 'w1',
      empresaId: 'emp-1',
      nome: 'h',
      ativo: true,
    });
    await svc.processar('tok', { x: 1 });
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'WEBHOOK_RECEBIDO',
      expect.objectContaining({ webhookId: 'w1', payload: { x: 1 } }),
    );
  });

  it('processar lança 404 quando token inválido ou inativo', async () => {
    prisma.webhookEntrada.findUnique.mockResolvedValue(null);
    await expect(svc.processar('tok', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(bus.disparar).not.toHaveBeenCalled();
  });
});
