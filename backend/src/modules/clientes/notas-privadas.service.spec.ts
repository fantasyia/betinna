import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { NotasPrivadasService } from './notas-privadas.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  notaPrivada: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } satisfies MockModel,
});

const makeClientesMock = () => ({
  findById: vi.fn().mockResolvedValue({ id: 'cli-1', empresaId: 'emp-1' }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'user@betinna.ai',
  nome: 'User',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakaNota = (overrides: Record<string, unknown> = {}) => ({
  id: 'nota-1',
  clienteId: 'cli-1',
  usuarioId: 'user-1',
  texto: 'Nota de teste',
  criadoEm: new Date('2026-06-01'),
  atualizadoEm: new Date('2026-06-01'),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('NotasPrivadasService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let clientes: ReturnType<typeof makeClientesMock>;
  let service: NotasPrivadasService;

  beforeEach(() => {
    prisma = makePrismaMock();
    clientes = makeClientesMock();
    service = new NotasPrivadasService(prisma as never, clientes as never);
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('lista notas do cliente quando acesso permitido', async () => {
      prisma.notaPrivada.findMany.mockResolvedValue([fakaNota()]);

      const result = await service.list(fakeUser(), 'cli-1');

      expect(result).toHaveLength(1);
      expect(clientes.findById).toHaveBeenCalledWith(fakeUser(), 'cli-1');
    });

    it('filtra por clienteId na query', async () => {
      prisma.notaPrivada.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), 'cli-1');

      const args = prisma.notaPrivada.findMany.mock.calls[0][0];
      expect(args.where.clienteId).toBe('cli-1');
    });

    it('propaga NotFoundException se cliente não existe', async () => {
      clientes.findById.mockRejectedValue(new NotFoundException('Cliente', 'nao-existe'));

      await expect(service.list(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('cria nota com usuarioId do JWT', async () => {
      const nota = fakaNota();
      prisma.notaPrivada.create.mockResolvedValue(nota);

      await service.create(fakeUser({ id: 'user-42' }), 'cli-1', { texto: 'Texto da nota' });

      const data = prisma.notaPrivada.create.mock.calls[0][0].data;
      expect(data.usuarioId).toBe('user-42');
      expect(data.clienteId).toBe('cli-1');
      expect(data.texto).toBe('Texto da nota');
    });

    it('valida acesso ao cliente antes de criar', async () => {
      prisma.notaPrivada.create.mockResolvedValue(fakaNota());

      await service.create(fakeUser(), 'cli-1', { texto: 'Texto' });

      expect(clientes.findById).toHaveBeenCalled();
    });

    it('propaga NotFoundException se cliente não existe', async () => {
      clientes.findById.mockRejectedValue(new NotFoundException('Cliente', 'nao-existe'));

      await expect(
        service.create(fakeUser(), 'nao-existe', { texto: 'Texto' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('autor pode editar a própria nota', async () => {
      const nota = fakaNota({ usuarioId: 'user-1' });
      const updated = fakaNota({ texto: 'Texto atualizado' });
      prisma.notaPrivada.findFirst.mockResolvedValue(nota);
      prisma.notaPrivada.update.mockResolvedValue(updated);

      const result = await service.update(fakeUser({ id: 'user-1' }), 'cli-1', 'nota-1', {
        texto: 'Texto atualizado',
      });

      expect(result.texto).toBe('Texto atualizado');
    });

    it('ADMIN pode editar nota de outro usuário', async () => {
      const nota = fakaNota({ usuarioId: 'outro-user' });
      prisma.notaPrivada.findFirst.mockResolvedValue(nota);
      prisma.notaPrivada.update.mockResolvedValue(nota);

      await expect(
        service.update(fakeUser({ role: 'ADMIN', id: 'admin-1' }), 'cli-1', 'nota-1', {
          texto: 'Texto',
        }),
      ).resolves.toBeDefined();
    });

    it('REP não pode editar nota de outro usuário → ForbiddenException', async () => {
      const nota = fakaNota({ usuarioId: 'outro-user' });
      prisma.notaPrivada.findFirst.mockResolvedValue(nota);

      await expect(
        service.update(fakeUser({ role: 'REP', id: 'rep-1' }), 'cli-1', 'nota-1', {
          texto: 'Texto',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.notaPrivada.update).not.toHaveBeenCalled();
    });

    it('lança NotFoundException quando nota não existe', async () => {
      prisma.notaPrivada.findFirst.mockResolvedValue(null);

      await expect(
        service.update(fakeUser(), 'cli-1', 'nao-existe', { texto: 'Texto' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  describe('remove', () => {
    it('autor pode excluir a própria nota', async () => {
      const nota = fakaNota({ usuarioId: 'user-1' });
      prisma.notaPrivada.findFirst.mockResolvedValue(nota);
      prisma.notaPrivada.delete.mockResolvedValue(nota);

      await expect(
        service.remove(fakeUser({ id: 'user-1' }), 'cli-1', 'nota-1'),
      ).resolves.toBeUndefined();

      expect(prisma.notaPrivada.delete).toHaveBeenCalledWith({ where: { id: 'nota-1' } });
    });

    it('ADMIN pode excluir nota de outro usuário', async () => {
      const nota = fakaNota({ usuarioId: 'outro-user' });
      prisma.notaPrivada.findFirst.mockResolvedValue(nota);
      prisma.notaPrivada.delete.mockResolvedValue(nota);

      await expect(
        service.remove(fakeUser({ role: 'ADMIN', id: 'admin-1' }), 'cli-1', 'nota-1'),
      ).resolves.toBeUndefined();
    });

    it('REP não pode excluir nota de outro usuário → ForbiddenException', async () => {
      const nota = fakaNota({ usuarioId: 'outro-user' });
      prisma.notaPrivada.findFirst.mockResolvedValue(nota);

      await expect(
        service.remove(fakeUser({ role: 'REP', id: 'rep-1' }), 'cli-1', 'nota-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.notaPrivada.delete).not.toHaveBeenCalled();
    });

    it('lança NotFoundException quando nota não existe', async () => {
      prisma.notaPrivada.findFirst.mockResolvedValue(null);

      await expect(service.remove(fakeUser(), 'cli-1', 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
