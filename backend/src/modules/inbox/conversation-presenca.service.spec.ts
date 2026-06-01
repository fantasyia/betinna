import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ConversationPresencaService } from './conversation-presenca.service';

const makeRedisMock = () => ({
  get: vi.fn().mockResolvedValue(null),
  setEx: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(1),
});

const makeInboxMock = () => ({
  findById: vi.fn().mockResolvedValue({ id: 'conv-1', empresaId: 'emp-1' }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'a@betinna.ai',
  nome: 'Ana',
  role: 'SAC' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

describe('ConversationPresencaService', () => {
  let redis: ReturnType<typeof makeRedisMock>;
  let inbox: ReturnType<typeof makeInboxMock>;
  let service: ConversationPresencaService;

  beforeEach(() => {
    redis = makeRedisMock();
    inbox = makeInboxMock();
    service = new ConversationPresencaService(redis as never, inbox as never);
  });

  describe('heartbeat', () => {
    it('valida acesso e, sem ninguém mais, retorna outros vazio', async () => {
      const r = await service.heartbeat(fakeUser(), 'conv-1');
      expect(inbox.findById).toHaveBeenCalledWith(fakeUser(), 'conv-1');
      expect(r.outros).toEqual([]);
      expect(redis.setEx).toHaveBeenCalled();
    });

    it('retorna outro atendente que está com a conversa aberta', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ 'user-2': { nome: 'Bruno', ts: Date.now() - 1_000 } }),
      );
      const r = await service.heartbeat(fakeUser({ id: 'user-1' }), 'conv-1');
      expect(r.outros).toEqual([{ id: 'user-2', nome: 'Bruno' }]);
    });

    it('ignora presença velha (heartbeat antigo > 45s)', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ 'user-3': { nome: 'Caio', ts: Date.now() - 120_000 } }),
      );
      const r = await service.heartbeat(fakeUser({ id: 'user-1' }), 'conv-1');
      expect(r.outros).toEqual([]);
      // a entrada velha foi podada antes de persistir
      const persisted = JSON.parse(redis.setEx.mock.calls[0][1]);
      expect(persisted['user-3']).toBeUndefined();
      expect(persisted['user-1']).toBeDefined();
    });

    it('propaga NotFoundException quando a conversa está fora de escopo', async () => {
      inbox.findById.mockRejectedValue(new NotFoundException('Conversation', 'x'));
      await expect(service.heartbeat(fakeUser(), 'x')).rejects.toBeInstanceOf(NotFoundException);
      expect(redis.setEx).not.toHaveBeenCalled();
    });
  });

  describe('sair', () => {
    it('remove a própria presença e apaga a chave quando fica vazia', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ 'user-1': { nome: 'Ana', ts: Date.now() } }));
      const r = await service.sair(fakeUser({ id: 'user-1' }), 'conv-1');
      expect(r).toEqual({ ok: true });
      expect(redis.del).toHaveBeenCalled();
    });

    it('mantém os outros quando ainda há presença após sair', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          'user-1': { nome: 'Ana', ts: Date.now() },
          'user-2': { nome: 'Bruno', ts: Date.now() },
        }),
      );
      await service.sair(fakeUser({ id: 'user-1' }), 'conv-1');
      expect(redis.del).not.toHaveBeenCalled();
      const persisted = JSON.parse(redis.setEx.mock.calls[0][1]);
      expect(persisted['user-1']).toBeUndefined();
      expect(persisted['user-2']).toBeDefined();
    });
  });
});
