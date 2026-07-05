import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CampanhaTemplateService } from './campanha-template.service';

const makePrisma = () => ({
  campanhaTemplate: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 't1' }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 't1', nome: 'X' }),
  },
});

const user = (o: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  email: 'a@b.com',
  nome: 'A',
  role: 'DIRECTOR' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...o,
});

describe('CampanhaTemplateService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: CampanhaTemplateService;
  beforeEach(() => {
    prisma = makePrisma();
    svc = new CampanhaTemplateService(prisma as never);
  });

  it('list filtra por empresa ativa', async () => {
    await svc.list(user());
    expect(prisma.campanhaTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: 'emp-1' } }),
    );
  });

  it('create grava empresaId + criadoPorId do JWT', async () => {
    await svc.create(user({ id: 'u9', empresaIdAtiva: 'emp-9' }), {
      nome: 'Boas-vindas',
      canal: 'EMAIL',
      assunto: 'Oi',
      mensagemEmail: 'corpo',
    });
    const data = prisma.campanhaTemplate.create.mock.calls[0][0].data;
    expect(data.empresaId).toBe('emp-9');
    expect(data.criadoPorId).toBe('u9');
    expect(data.nome).toBe('Boas-vindas');
  });

  it('update filtra por empresa (multi-tenant) e 404 quando não bate', async () => {
    prisma.campanhaTemplate.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.update(user(), 'outra', { nome: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const where = prisma.campanhaTemplate.updateMany.mock.calls[0][0].where;
    expect(where).toEqual({ id: 'outra', empresaId: 'emp-1' });
  });

  it('remove filtra por empresa e 404 quando não existe', async () => {
    prisma.campanhaTemplate.deleteMany.mockResolvedValue({ count: 0 });
    await expect(svc.remove(user(), 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
