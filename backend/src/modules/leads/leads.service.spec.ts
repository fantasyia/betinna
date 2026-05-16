import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { LeadsService } from './leads.service';

const makePrismaMock = () => ({
  lead: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    groupBy: vi.fn(),
  },
  usuario: { findFirst: vi.fn() },
});

const makeRepScope = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    if (u.role === 'GERENTE') return [];
    return null;
  }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'rep-1',
  email: 'rep@betinna.ai',
  nome: 'Rep',
  role: 'REP' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

describe('LeadsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: LeadsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new LeadsService(prisma as never, makeRepScope() as never, { disparar: vi.fn() } as never);
  });

  describe('rep filtering', () => {
    it('REP só vê leads onde representanteId = user.id', async () => {
      prisma.lead.count.mockResolvedValue(0);
      prisma.lead.findMany.mockResolvedValue([]);
      await svc.list(fakeUser(), {
        page: 1,
        limit: 20,
        sortBy: 'criadoEm',
        sortOrder: 'desc',
      });
      const where = prisma.lead.findMany.mock.calls[0][0].where;
      expect(where.representanteId).toEqual({ in: ['rep-1'] });
    });

    it('Admin vê todos os leads da empresa', async () => {
      prisma.lead.count.mockResolvedValue(0);
      prisma.lead.findMany.mockResolvedValue([]);
      await svc.list(fakeUser({ role: 'ADMIN' }), {
        page: 1,
        limit: 20,
        sortBy: 'criadoEm',
        sortOrder: 'desc',
      });
      const where = prisma.lead.findMany.mock.calls[0][0].where;
      expect(where.representanteId).toBeUndefined();
    });

    it('REP criando lead tem representanteId auto-atribuído', async () => {
      prisma.usuario.findFirst.mockResolvedValue({ id: 'rep-1' });
      prisma.lead.create.mockResolvedValue({ id: 'l1' });
      await svc.create(fakeUser(), {
        nome: 'Padaria X',
        valorEstimado: 1000,
        canalOrigem: 'WHATSAPP',
        etapa: 'NOVO',
        score: 50,
      });
      const data = prisma.lead.create.mock.calls[0][0].data;
      expect(data.representanteId).toBe('rep-1');
    });
  });

  describe('máquina de estados', () => {
    it('rejeita transição inválida (NOVO → GANHO direto)', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'l1', empresaId: 'emp-1', representanteId: 'rep-1', etapa: 'NOVO' });
      await expect(
        svc.moverEtapa(fakeUser(), 'l1', { etapa: 'GANHO', motivo: 'qualquer' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('aceita NOVO → QUALIFICANDO', async () => {
      const fakeLead = { id: 'l1', empresaId: 'emp-1', representanteId: 'rep-1', etapa: 'QUALIFICANDO' };
      prisma.lead.findFirst.mockResolvedValue({ id: 'l1', empresaId: 'emp-1', representanteId: 'rep-1', etapa: 'NOVO' });
      prisma.lead.updateMany.mockResolvedValue({ count: 1 });
      prisma.lead.findUniqueOrThrow.mockResolvedValue(fakeLead);
      const result = await svc.moverEtapa(fakeUser(), 'l1', { etapa: 'QUALIFICANDO' });
      expect(result.etapa).toBe('QUALIFICANDO');
      const data = prisma.lead.updateMany.mock.calls[0][0].data;
      expect(data.etapaDesde).toBeInstanceOf(Date);
    });

    it('PROPOSTA → GANHO requer motivo (validado no DTO, mas confirma também aqui)', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'l1', empresaId: 'emp-1', representanteId: 'rep-1', etapa: 'PROPOSTA' });
      prisma.lead.updateMany.mockResolvedValue({ count: 1 });
      prisma.lead.findUniqueOrThrow.mockResolvedValue({ id: 'l1', etapa: 'GANHO' });
      await svc.moverEtapa(fakeUser(), 'l1', { etapa: 'GANHO', motivo: 'Cliente VIP fechou' });
      const data = prisma.lead.updateMany.mock.calls[0][0].data;
      expect(data.motivoGanho).toBe('Cliente VIP fechou');
      expect(data.fechadoEm).toBeInstanceOf(Date);
    });

    it('reabre PERDIDO movendo pra NOVO limpa motivos', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'l1',
        empresaId: 'emp-1',
        representanteId: 'rep-1',
        etapa: 'PERDIDO',
      });
      prisma.lead.updateMany.mockResolvedValue({ count: 1 });
      prisma.lead.findUniqueOrThrow.mockResolvedValue({ id: 'l1', etapa: 'NOVO' });
      await svc.moverEtapa(fakeUser(), 'l1', { etapa: 'NOVO' });
      const data = prisma.lead.updateMany.mock.calls[0][0].data;
      expect(data.motivoPerda).toBeNull();
      expect(data.motivoGanho).toBeNull();
      expect(data.fechadoEm).toBeNull();
    });

    it('GANHO é terminal — bloqueia qualquer transição', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'l1', empresaId: 'emp-1', representanteId: 'rep-1', etapa: 'GANHO' });
      await expect(
        svc.moverEtapa(fakeUser(), 'l1', { etapa: 'NOVO' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('Lead fechado não pode ser editado (update simples)', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'l1', empresaId: 'emp-1', representanteId: 'rep-1', etapa: 'GANHO' });
      await expect(svc.update(fakeUser(), 'l1', { score: 80 })).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  describe('not found', () => {
    it('lança NotFound quando lead não pertence ao escopo do user', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);
      await expect(svc.findById(fakeUser(), 'xxx')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
