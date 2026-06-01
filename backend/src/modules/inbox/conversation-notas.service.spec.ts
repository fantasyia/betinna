import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ConversationNotasService } from './conversation-notas.service';

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  conversationNota: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } satisfies MockModel,
  conversation: {
    update: vi.fn(),
  } satisfies MockModel,
});

// InboxService.findById é o gate de acesso (tenant + carteira REP).
const makeInboxMock = () => ({
  findById: vi.fn().mockResolvedValue({ id: 'conv-1', empresaId: 'emp-1' }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'user@betinna.ai',
  nome: 'User',
  role: 'SAC' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeNota = (overrides: Record<string, unknown> = {}) => ({
  id: 'nota-1',
  conversationId: 'conv-1',
  usuarioId: 'user-1',
  texto: 'Cliente pediu desconto',
  criadoEm: new Date('2026-06-01'),
  atualizadoEm: new Date('2026-06-01'),
  ...overrides,
});

describe('ConversationNotasService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let inbox: ReturnType<typeof makeInboxMock>;
  let service: ConversationNotasService;

  beforeEach(() => {
    prisma = makePrismaMock();
    inbox = makeInboxMock();
    service = new ConversationNotasService(prisma as never, inbox as never);
  });

  describe('listar', () => {
    it('valida acesso à conversa e lista notas', async () => {
      prisma.conversationNota.findMany.mockResolvedValue([fakeNota()]);

      const r = await service.listar(fakeUser(), 'conv-1');

      expect(inbox.findById).toHaveBeenCalledWith(fakeUser(), 'conv-1');
      expect(r).toHaveLength(1);
      expect(prisma.conversationNota.findMany.mock.calls[0][0].where.conversationId).toBe('conv-1');
    });

    it('propaga NotFoundException quando a conversa está fora de escopo', async () => {
      inbox.findById.mockRejectedValue(new NotFoundException('Conversation', 'x'));
      await expect(service.listar(fakeUser(), 'x')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.conversationNota.findMany).not.toHaveBeenCalled();
    });
  });

  describe('criar', () => {
    it('cria com usuarioId do JWT após validar acesso', async () => {
      prisma.conversationNota.create.mockResolvedValue(fakeNota());

      await service.criar(fakeUser({ id: 'user-42' }), 'conv-1', 'Texto');

      expect(inbox.findById).toHaveBeenCalled();
      const data = prisma.conversationNota.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        conversationId: 'conv-1',
        usuarioId: 'user-42',
        texto: 'Texto',
      });
    });
  });

  describe('editar', () => {
    it('autor edita a própria nota', async () => {
      prisma.conversationNota.findFirst.mockResolvedValue(fakeNota({ usuarioId: 'user-1' }));
      prisma.conversationNota.update.mockResolvedValue(fakeNota({ texto: 'novo' }));

      const r = await service.editar(fakeUser({ id: 'user-1' }), 'conv-1', 'nota-1', 'novo');
      expect(r.texto).toBe('novo');
    });

    it('ADMIN edita nota de outro', async () => {
      prisma.conversationNota.findFirst.mockResolvedValue(fakeNota({ usuarioId: 'outro' }));
      prisma.conversationNota.update.mockResolvedValue(fakeNota());

      await expect(
        service.editar(fakeUser({ role: 'ADMIN', id: 'admin-1' }), 'conv-1', 'nota-1', 'x'),
      ).resolves.toBeDefined();
    });

    it('não-autor não-ADMIN → ForbiddenException', async () => {
      prisma.conversationNota.findFirst.mockResolvedValue(fakeNota({ usuarioId: 'outro' }));

      await expect(
        service.editar(fakeUser({ role: 'SAC', id: 'sac-1' }), 'conv-1', 'nota-1', 'x'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.conversationNota.update).not.toHaveBeenCalled();
    });

    it('nota inexistente → NotFoundException', async () => {
      prisma.conversationNota.findFirst.mockResolvedValue(null);
      await expect(service.editar(fakeUser(), 'conv-1', 'nao-existe', 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remover', () => {
    it('autor remove a própria nota', async () => {
      prisma.conversationNota.findFirst.mockResolvedValue(fakeNota({ usuarioId: 'user-1' }));
      prisma.conversationNota.delete.mockResolvedValue(fakeNota());

      const r = await service.remover(fakeUser({ id: 'user-1' }), 'conv-1', 'nota-1');
      expect(r).toEqual({ ok: true });
      expect(prisma.conversationNota.delete).toHaveBeenCalledWith({ where: { id: 'nota-1' } });
    });

    it('não-autor não-ADMIN → ForbiddenException', async () => {
      prisma.conversationNota.findFirst.mockResolvedValue(fakeNota({ usuarioId: 'outro' }));
      await expect(
        service.remover(fakeUser({ role: 'GERENTE', id: 'g-1' }), 'conv-1', 'nota-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.conversationNota.delete).not.toHaveBeenCalled();
    });
  });

  describe('definirTags', () => {
    it('normaliza (trim, remove vazias, dedupe case-insensitive) e persiste', async () => {
      prisma.conversation.update.mockResolvedValue({ tagsInternas: ['urgente', 'VIP'] });

      const r = await service.definirTags(fakeUser(), 'conv-1', [
        '  urgente ',
        'urgente',
        'URGENTE',
        '',
        '  ',
        'VIP',
      ]);

      expect(inbox.findById).toHaveBeenCalled();
      const data = prisma.conversation.update.mock.calls[0][0].data;
      expect(data.tagsInternas).toEqual(['urgente', 'VIP']);
      expect(r.tagsInternas).toEqual(['urgente', 'VIP']);
    });

    it('limita a 12 tags', async () => {
      prisma.conversation.update.mockResolvedValue({ tagsInternas: [] });
      const muitas = Array.from({ length: 20 }, (_, i) => `tag${i}`);

      await service.definirTags(fakeUser(), 'conv-1', muitas);

      const data = prisma.conversation.update.mock.calls[0][0].data;
      expect(data.tagsInternas).toHaveLength(12);
    });
  });
});
