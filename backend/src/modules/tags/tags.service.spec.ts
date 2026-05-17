import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma, type Tag, type UserRole } from '@prisma/client';
import { TagsService } from './tags.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockTag = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  tag: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  } satisfies MockTag,
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'admin@betinna.ai',
  nome: 'Admin Teste',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeTag = (overrides: Partial<Tag> = {}): Tag => ({
  id: 'tag-1',
  empresaId: 'emp-1',
  nome: 'VIP',
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-01'),
  ...overrides,
});

const fakeTagWithCount = (overrides: Partial<Tag> = {}) => ({
  ...fakeTag(overrides),
  _count: { clientes: 0 },
});

/** Constrói um Prisma.PrismaClientKnownRequestError com code P2002. */
const makePrismaP2002 = () => {
  const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.0.0',
  });
  return err;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TagsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: TagsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new TagsService(prisma as never);
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('retorna lista de tags com contagem de clientes', async () => {
      const tags = [fakeTagWithCount(), fakeTagWithCount({ id: 'tag-2', nome: 'Prospect' })];
      prisma.tag.findMany.mockResolvedValue(tags);

      const result = await service.list(fakeUser(), {});

      expect(result).toEqual(tags);
      expect(prisma.tag.findMany).toHaveBeenCalledOnce();
    });

    it('inclui include _count.clientes na query', async () => {
      prisma.tag.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), {});

      const args = prisma.tag.findMany.mock.calls[0][0];
      expect(args.include).toEqual({ _count: { select: { clientes: true } } });
    });

    it('ordena por nome asc', async () => {
      prisma.tag.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), {});

      const args = prisma.tag.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ nome: 'asc' });
    });

    it('aplica filtro de texto (search) case-insensitive', async () => {
      prisma.tag.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { search: 'vip' });

      const args = prisma.tag.findMany.mock.calls[0][0];
      expect(args.where.nome).toEqual({ contains: 'vip', mode: 'insensitive' });
    });

    it('não inclui filtro de nome quando search não é passado', async () => {
      prisma.tag.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), {});

      const args = prisma.tag.findMany.mock.calls[0][0];
      expect(args.where.nome).toBeUndefined();
    });

    it('filtra por empresaId para usuário não-ADMIN', async () => {
      const gerente = fakeUser({ role: 'GERENTE', empresaIdAtiva: 'emp-99' });
      prisma.tag.findMany.mockResolvedValue([]);

      await service.list(gerente, {});

      const args = prisma.tag.findMany.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-99');
    });

    it('ADMIN não tem filtro empresaId na query (acesso global)', async () => {
      prisma.tag.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'ADMIN' }), {});

      const args = prisma.tag.findMany.mock.calls[0][0];
      // empresaFilter para ADMIN retorna {} — não injeta empresaId
      expect(args.where.empresaId).toBeUndefined();
    });

    it('lança ForbiddenException quando usuário não-ADMIN não tem empresaIdAtiva', async () => {
      const user = fakeUser({ role: 'GERENTE', empresaIdAtiva: null });

      await expect(service.list(user, {})).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('retorna tag quando encontrada', async () => {
      const tag = fakeTagWithCount();
      prisma.tag.findFirst.mockResolvedValue(tag);

      const result = await service.findById(fakeUser(), 'tag-1');

      expect(result).toEqual(tag);
    });

    it('passa id e empresaId no where (defesa em profundidade)', async () => {
      prisma.tag.findFirst.mockResolvedValue(fakeTagWithCount());

      await service.findById(fakeUser({ role: 'GERENTE', empresaIdAtiva: 'emp-2' }), 'tag-1');

      const args = prisma.tag.findFirst.mock.calls[0][0];
      expect(args.where.id).toBe('tag-1');
      expect(args.where.empresaId).toBe('emp-2');
    });

    it('lança NotFoundException quando tag não existe', async () => {
      prisma.tag.findFirst.mockResolvedValue(null);

      await expect(service.findById(fakeUser(), 'inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('inclui _count.clientes no resultado', async () => {
      prisma.tag.findFirst.mockResolvedValue(fakeTagWithCount());

      await service.findById(fakeUser(), 'tag-1');

      const args = prisma.tag.findFirst.mock.calls[0][0];
      expect(args.include).toEqual({ _count: { select: { clientes: true } } });
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('cria tag com empresaId do usuário autenticado', async () => {
      const tag = fakeTag();
      prisma.tag.create.mockResolvedValue(tag);

      const result = await service.create(fakeUser({ empresaIdAtiva: 'emp-1' }), { nome: 'VIP', cor: '#7c3aed' });

      expect(result).toEqual(tag);
      const data = prisma.tag.create.mock.calls[0][0].data;
      expect(data.empresaId).toBe('emp-1');
      expect(data.nome).toBe('VIP');
    });

    it('não usa empresaId do DTO — sempre do JWT', async () => {
      // Mesmo que o corpo viesse com empresaId, o service usa getCallerEmpresaId(user)
      prisma.tag.create.mockResolvedValue(fakeTag());

      await service.create(fakeUser({ empresaIdAtiva: 'emp-correto' }), { nome: 'Tag X', cor: '#7c3aed' });

      const data = prisma.tag.create.mock.calls[0][0].data;
      expect(data.empresaId).toBe('emp-correto');
    });

    it('lança BusinessRuleException em conflito de nome (P2002)', async () => {
      prisma.tag.create.mockRejectedValue(makePrismaP2002());

      await expect(service.create(fakeUser(), { nome: 'VIP', cor: '#7c3aed' })).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('relança erros que não são P2002', async () => {
      const internalError = new Error('DB connection error');
      prisma.tag.create.mockRejectedValue(internalError);

      await expect(service.create(fakeUser(), { nome: 'VIP', cor: '#7c3aed' })).rejects.toBe(internalError);
    });

    it('lança ForbiddenException quando usuário não tem empresaIdAtiva', async () => {
      const user = fakeUser({ role: 'GERENTE', empresaIdAtiva: null });

      await expect(service.create(user, { nome: 'Nova', cor: '#7c3aed' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('atualiza tag e retorna versão nova', async () => {
      const updated = fakeTag({ nome: 'Premium' });
      prisma.tag.findFirst.mockResolvedValue(fakeTagWithCount());
      prisma.tag.updateMany.mockResolvedValue({ count: 1 });
      prisma.tag.findUniqueOrThrow.mockResolvedValue(updated);

      const result = await service.update(fakeUser(), 'tag-1', { nome: 'Premium' });

      expect(result).toEqual(updated);
    });

    it('usa updateMany com id E empresaId (proteção TOCTOU)', async () => {
      prisma.tag.findFirst.mockResolvedValue(fakeTagWithCount({ empresaId: 'emp-1' }));
      prisma.tag.updateMany.mockResolvedValue({ count: 1 });
      prisma.tag.findUniqueOrThrow.mockResolvedValue(fakeTag());

      await service.update(fakeUser(), 'tag-1', { nome: 'Novo Nome' });

      const updateArgs = prisma.tag.updateMany.mock.calls[0][0];
      expect(updateArgs.where.id).toBe('tag-1');
      expect(updateArgs.where.empresaId).toBe('emp-1');
    });

    it('lança NotFoundException quando tag não pertence à empresa', async () => {
      prisma.tag.findFirst.mockResolvedValue(null);

      await expect(service.update(fakeUser(), 'tag-errada', { nome: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lança BusinessRuleException em conflito de nome (P2002 no updateMany)', async () => {
      prisma.tag.findFirst.mockResolvedValue(fakeTagWithCount());
      prisma.tag.updateMany.mockRejectedValue(makePrismaP2002());

      await expect(service.update(fakeUser(), 'tag-1', { nome: 'VIP', cor: '#7c3aed' })).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('relança erros que não são P2002 durante update', async () => {
      const internalError = new Error('DB timeout');
      prisma.tag.findFirst.mockResolvedValue(fakeTagWithCount());
      prisma.tag.updateMany.mockRejectedValue(internalError);

      await expect(service.update(fakeUser(), 'tag-1', { nome: 'X' })).rejects.toBe(internalError);
    });

    it('usa findUniqueOrThrow no final para retornar dados atualizados', async () => {
      prisma.tag.findFirst.mockResolvedValue(fakeTagWithCount());
      prisma.tag.updateMany.mockResolvedValue({ count: 1 });
      prisma.tag.findUniqueOrThrow.mockResolvedValue(fakeTag({ nome: 'Atualizado' }));

      await service.update(fakeUser(), 'tag-1', { nome: 'Atualizado' });

      expect(prisma.tag.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'tag-1' } });
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  describe('remove', () => {
    it('remove tag quando existe na empresa', async () => {
      prisma.tag.findFirst.mockResolvedValue(fakeTagWithCount({ empresaId: 'emp-1' }));
      prisma.tag.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.remove(fakeUser(), 'tag-1')).resolves.toBeUndefined();
    });

    it('usa deleteMany com id E empresaId (proteção TOCTOU)', async () => {
      prisma.tag.findFirst.mockResolvedValue(fakeTagWithCount({ empresaId: 'emp-1' }));
      prisma.tag.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove(fakeUser(), 'tag-1');

      const deleteArgs = prisma.tag.deleteMany.mock.calls[0][0];
      expect(deleteArgs.where.id).toBe('tag-1');
      expect(deleteArgs.where.empresaId).toBe('emp-1');
    });

    it('lança NotFoundException quando tag não existe ou não pertence à empresa', async () => {
      prisma.tag.findFirst.mockResolvedValue(null);

      await expect(service.remove(fakeUser(), 'tag-inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('não chama deleteMany se findById falhar', async () => {
      prisma.tag.findFirst.mockResolvedValue(null);

      await expect(service.remove(fakeUser(), 'tag-errada')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.tag.deleteMany).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // upsertByName
  // -------------------------------------------------------------------------

  describe('upsertByName', () => {
    it('chama upsert com chave composta (empresaId, nome)', async () => {
      const tag = fakeTag({ nome: 'Novo' });
      prisma.tag.upsert.mockResolvedValue(tag);

      const result = await service.upsertByName('emp-1', 'Novo');

      expect(result).toEqual(tag);
      const args = prisma.tag.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ empresaId_nome: { empresaId: 'emp-1', nome: 'Novo' } });
    });

    it('cria tag quando não existe (create branch)', async () => {
      prisma.tag.upsert.mockResolvedValue(fakeTag({ nome: 'AutoTag' }));

      await service.upsertByName('emp-2', 'AutoTag');

      const args = prisma.tag.upsert.mock.calls[0][0];
      expect(args.create).toEqual({ empresaId: 'emp-2', nome: 'AutoTag' });
    });

    it('não altera nada quando tag já existe (update branch é vazio)', async () => {
      prisma.tag.upsert.mockResolvedValue(fakeTag());

      await service.upsertByName('emp-1', 'VIP');

      const args = prisma.tag.upsert.mock.calls[0][0];
      expect(args.update).toEqual({});
    });
  });
});
