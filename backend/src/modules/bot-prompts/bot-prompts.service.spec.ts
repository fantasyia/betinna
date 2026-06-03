import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { BotPromptsService } from './bot-prompts.service';

const makePrisma = () => {
  const botPrompt = {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'p1' }),
    update: vi.fn().mockResolvedValue({ id: 'p1' }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'p1' }),
  };
  return {
    botPrompt,
    // $transaction invoca o callback com o próprio mock (tx === prisma).
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({ botPrompt })),
  };
};

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  email: 'dir@x.com',
  nome: 'Diretor',
  role: 'DIRECTOR' as never,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

describe('BotPromptsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: BotPromptsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new BotPromptsService(prisma as never);
  });

  it('list filtra pela empresa ativa', async () => {
    await service.list(fakeUser(), {});
    const where = prisma.botPrompt.findMany.mock.calls[0][0].where;
    expect(where.empresaId).toBe('emp-1');
  });

  it('findById lança NotFound quando não existe', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue(null);
    await expect(service.findById(fakeUser(), 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create com isPadrao desmarca os outros padrões da empresa', async () => {
    await service.create(fakeUser(), { nome: 'P1', texto: 'oi', isPadrao: true });
    expect(prisma.botPrompt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId: 'emp-1', isPadrao: true },
        data: { isPadrao: false },
      }),
    );
    expect(prisma.botPrompt.create).toHaveBeenCalled();
  });

  it('create sem isPadrao não mexe nos demais', async () => {
    await service.create(fakeUser(), { nome: 'P1', texto: 'oi' });
    expect(prisma.botPrompt.updateMany).not.toHaveBeenCalled();
  });

  it('create traduz unique (P2002) em BusinessRuleException', async () => {
    prisma.botPrompt.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );
    await expect(service.create(fakeUser(), { nome: 'P1', texto: 'oi' })).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('definirPadrao desmarca os demais e marca este', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue({ id: 'p1', empresaId: 'emp-1' });
    await service.definirPadrao(fakeUser(), 'p1');
    expect(prisma.botPrompt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId: 'emp-1', isPadrao: true, id: { not: 'p1' } },
      }),
    );
    expect(prisma.botPrompt.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { isPadrao: true },
    });
  });

  it('remove apaga com escopo de empresa', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue({ id: 'p1', empresaId: 'emp-1' });
    await service.remove(fakeUser(), 'p1');
    expect(prisma.botPrompt.deleteMany).toHaveBeenCalledWith({
      where: { id: 'p1', empresaId: 'emp-1' },
    });
  });

  it('obterTextoPadrao retorna o texto (trim) do padrão ativo', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue({ texto: '  Prompt padrão  ' });
    expect(await service.obterTextoPadrao('emp-1')).toBe('Prompt padrão');
    const where = prisma.botPrompt.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ empresaId: 'emp-1', isPadrao: true, ativo: true });
  });

  it('obterTextoPadrao retorna null quando não há padrão', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue(null);
    expect(await service.obterTextoPadrao('emp-1')).toBeNull();
  });

  it('obterTextoPorId filtra por id + empresa + ativo', async () => {
    prisma.botPrompt.findFirst.mockResolvedValue({ texto: 'X' });
    await service.obterTextoPorId('emp-1', 'p9');
    const where = prisma.botPrompt.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'p9', empresaId: 'emp-1', ativo: true });
  });
});
