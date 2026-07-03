import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type UserRole } from '@prisma/client';
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
  // Funil/FunilEtapa (multi-funnel feature) — default = empresa sem funis,
  // service cai pro enum legado. Override por teste quando precisar de funil.
  funil: { findFirst: vi.fn().mockResolvedValue(null) },
  funilEtapa: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  },
  tag: { findFirst: vi.fn(), upsert: vi.fn() },
  leadTag: { upsert: vi.fn(), deleteMany: vi.fn() },
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
    svc = new LeadsService(
      prisma as never,
      makeRepScope() as never,
      { disparar: vi.fn() } as never,
    );
  });

  describe('tags do lead (Fase B)', () => {
    const leadRow = { id: 'lead-1', empresaId: 'emp-1', representanteId: 'rep-1', tags: [] };
    const admin = fakeUser({ role: 'ADMIN' as UserRole, id: 'admin-1' });

    it('adicionarTag aplica tag existente da empresa (origem usuario)', async () => {
      prisma.lead.findFirst.mockResolvedValue(leadRow);
      prisma.tag.findFirst.mockResolvedValue({ id: 'tag-1' });
      prisma.leadTag.upsert.mockResolvedValue({});
      await svc.adicionarTag(admin, 'lead-1', 'tag-1');
      expect(prisma.leadTag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ leadId: 'lead-1', tagId: 'tag-1', origem: 'usuario' }),
        }),
      );
    });

    it('adicionarTag rejeita tag de outra empresa (NotFound)', async () => {
      prisma.lead.findFirst.mockResolvedValue(leadRow);
      prisma.tag.findFirst.mockResolvedValue(null);
      await expect(svc.adicionarTag(admin, 'lead-1', 'tag-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.leadTag.upsert).not.toHaveBeenCalled();
    });

    it('removerTag deleta a ligação', async () => {
      prisma.lead.findFirst.mockResolvedValue(leadRow);
      prisma.leadTag.deleteMany.mockResolvedValue({ count: 1 });
      await svc.removerTag(admin, 'lead-1', 'tag-1');
      expect(prisma.leadTag.deleteMany).toHaveBeenCalledWith({
        where: { leadId: 'lead-1', tagId: 'tag-1' },
      });
    });

    it('aplicarTagPorNome faz upsert da tag e da ligação (origem ia)', async () => {
      prisma.tag.upsert.mockResolvedValue({ id: 'tag-ia' });
      prisma.leadTag.upsert.mockResolvedValue({});
      await svc.aplicarTagPorNome('emp-1', 'lead-1', 'Forte Sinergia', 'ia');
      expect(prisma.tag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { empresaId_nome: { empresaId: 'emp-1', nome: 'Forte Sinergia' } },
        }),
      );
      expect(prisma.leadTag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ tagId: 'tag-ia', origem: 'ia' }),
        }),
      );
    });
  });

  describe('resumoPipeline — dinheiro Prisma.Decimal (#17 Fase 5)', () => {
    it('soma valorEstimado Decimal e devolve number (não Decimal)', async () => {
      prisma.lead.groupBy.mockResolvedValue([
        {
          etapa: 'NEGOCIACAO',
          _count: { _all: 2 },
          _sum: { valorEstimado: new Prisma.Decimal('1000.50') },
        },
        {
          etapa: 'GANHO',
          _count: { _all: 1 },
          _sum: { valorEstimado: new Prisma.Decimal('500') },
        },
      ]);
      prisma.lead.count.mockResolvedValue(0);

      const r = await svc.resumoPipeline(fakeUser({ role: 'ADMIN' as UserRole }));

      const negociacao = r.porEtapa.find((p) => p.etapa === 'NEGOCIACAO')!;
      // Se valorTotal fosse Decimal, toBe(1000.5) falharia (Decimal !== number).
      expect(negociacao.valorTotal).toBe(1000.5);
      expect(typeof negociacao.valorTotal).toBe('number');
      expect(typeof negociacao.ponderado).toBe('number');
      expect(Number.isNaN(negociacao.ponderado)).toBe(false);
      // pipelineTotal exclui GANHO/PERDIDO → só NEGOCIACAO (1000.5)
      expect(r.pipelineTotal).toBe(1000.5);
      expect(typeof r.pipelineTotal).toBe('number');
    });
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

    it('P0: create com funilId de outra empresa é rejeitado', async () => {
      prisma.usuario.findFirst.mockResolvedValue({ id: 'rep-1' });
      prisma.funil.findFirst.mockResolvedValue(null); // funil não pertence à empresa
      await expect(
        svc.create(fakeUser(), {
          nome: 'Padaria X',
          valorEstimado: 0,
          canalOrigem: 'WHATSAPP',
          etapa: 'NOVO',
          score: 0,
          funilId: 'funil-de-outro-tenant',
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.lead.create).not.toHaveBeenCalled();
    });
  });

  describe('update — coerência funil/etapa (P0)', () => {
    it('rejeita etapa que não pertence ao funil informado', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'l1',
        empresaId: 'emp-1',
        representanteId: 'rep-1',
        etapa: 'NOVO',
      });
      // Etapa existe na empresa, mas é do funil-B (≠ funil-A informado no DTO).
      prisma.funilEtapa.findFirst.mockResolvedValue({ id: 'etapaX', funilId: 'funil-B' });
      await expect(
        svc.update(fakeUser(), 'l1', { funilId: 'funil-A', funilEtapaId: 'etapaX' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.lead.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('máquina de estados', () => {
    it('rejeita transição inválida (PERDIDO → GANHO direto)', async () => {
      // PERDIDO só pode voltar pra etapas ATIVAS (reabrir o lead).
      // Pra fechar como GANHO depois, precisa primeiro reabrir e seguir o
      // funil normal. Esse teste cobre o gate da máquina de estados.
      prisma.lead.findFirst.mockResolvedValue({
        id: 'l1',
        empresaId: 'emp-1',
        representanteId: 'rep-1',
        etapa: 'PERDIDO',
      });
      await expect(
        svc.moverEtapa(fakeUser(), 'l1', { etapa: 'GANHO', motivo: 'qualquer' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('aceita NOVO → QUALIFICANDO', async () => {
      const fakeLead = {
        id: 'l1',
        empresaId: 'emp-1',
        representanteId: 'rep-1',
        etapa: 'QUALIFICANDO',
      };
      prisma.lead.findFirst.mockResolvedValue({
        id: 'l1',
        empresaId: 'emp-1',
        representanteId: 'rep-1',
        etapa: 'NOVO',
      });
      prisma.lead.updateMany.mockResolvedValue({ count: 1 });
      prisma.lead.findUniqueOrThrow.mockResolvedValue(fakeLead);
      const result = await svc.moverEtapa(fakeUser(), 'l1', { etapa: 'QUALIFICANDO' });
      expect(result.etapa).toBe('QUALIFICANDO');
      const data = prisma.lead.updateMany.mock.calls[0][0].data;
      expect(data.etapaDesde).toBeInstanceOf(Date);
    });

    it('PROPOSTA → GANHO requer motivo (validado no DTO, mas confirma também aqui)', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'l1',
        empresaId: 'emp-1',
        representanteId: 'rep-1',
        etapa: 'PROPOSTA',
      });
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

    it('move por funilEtapaId com FK escalar (não relation connect) — compat updateMany', async () => {
      // Regressão: updateMany NÃO aceita `funilEtapa: { connect }`. Tem que ser o
      // FK escalar `funilEtapaId`, senão o Prisma rejeita ("validation error").
      prisma.lead.findFirst.mockResolvedValue({
        id: 'l1',
        empresaId: 'emp-1',
        representanteId: 'rep-1',
        etapa: 'NOVO',
        funilId: 'funil-1',
        funilEtapaId: 'et-old',
        nome: 'Lead X',
      });
      prisma.funilEtapa.findFirst.mockResolvedValue({
        id: 'et-new',
        tipo: 'ATIVA',
        ordem: 1,
        funil: { id: 'funil-1', empresaId: 'emp-1' },
      });
      prisma.lead.updateMany.mockResolvedValue({ count: 1 });
      prisma.lead.findUniqueOrThrow.mockResolvedValue({
        id: 'l1',
        etapa: 'QUALIFICANDO',
        funilEtapaId: 'et-new',
      });

      await svc.moverEtapa(fakeUser(), 'l1', { funilEtapaId: 'et-new' });

      const data = prisma.lead.updateMany.mock.calls[0][0].data;
      expect(data.funilEtapaId).toBe('et-new');
      expect(data.funilEtapa).toBeUndefined(); // sem relation connect
    });

    it('GANHO é terminal — bloqueia qualquer transição', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'l1',
        empresaId: 'emp-1',
        representanteId: 'rep-1',
        etapa: 'GANHO',
      });
      await expect(svc.moverEtapa(fakeUser(), 'l1', { etapa: 'NOVO' })).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('Lead fechado não pode ser editado (update simples)', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'l1',
        empresaId: 'emp-1',
        representanteId: 'rep-1',
        etapa: 'GANHO',
      });
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
