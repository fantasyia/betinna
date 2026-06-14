import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { RelatoriosService } from './relatorios.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makeAggrResult = (overrides: Record<string, unknown> = {}) => ({
  _sum: { total: null, valorEstimado: null, valor: null, comissaoValor: null },
  _count: { _all: 0 },
  _avg: { total: null },
  ...overrides,
});

const makePrismaMock = () => ({
  pedido: {
    aggregate: vi.fn().mockResolvedValue(makeAggrResult()),
    groupBy: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  lead: {
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  funil: {
    findFirst: vi.fn().mockResolvedValue(null),
  } satisfies MockModel,
  ocorrencia: {
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue(makeAggrResult()),
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  campanha: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  campanhaDestinatario: {
    count: vi.fn().mockResolvedValue(0),
  } satisfies MockModel,
  amostra: {
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue(makeAggrResult()),
    groupBy: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  comissao: {
    groupBy: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue(makeAggrResult()),
    findMany: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  usuario: {
    findMany: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
});

const makeRepScopeMock = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    if (u.role === 'GERENTE') return ['rep-a', 'rep-b'];
    return null;
  }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@betinna.ai',
  nome: 'Admin',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const basePeriodo = {
  de: new Date('2026-01-01'),
  ate: new Date('2026-01-31'),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RelatoriosService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repScope: ReturnType<typeof makeRepScopeMock>;
  let service: RelatoriosService;

  beforeEach(() => {
    prisma = makePrismaMock();
    repScope = makeRepScopeMock();
    service = new RelatoriosService(
      prisma as never,
      repScope as never,
      {
        get: vi.fn().mockResolvedValue(null),
        setEx: vi.fn().mockResolvedValue(undefined),
      } as never,
    );
  });

  // -------------------------------------------------------------------------
  // Controle de acesso — ForbiddenException sem empresaIdAtiva
  // -------------------------------------------------------------------------

  describe('acesso sem empresaIdAtiva → ForbiddenException', () => {
    const noEmp = fakeUser({ empresaIdAtiva: null });

    it('vendas', async () => {
      await expect(service.vendas(noEmp, basePeriodo)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('funil', async () => {
      await expect(service.funil(noEmp, basePeriodo)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('comissoes', async () => {
      await expect(service.comissoes(noEmp, basePeriodo)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('sac', async () => {
      await expect(service.sac(noEmp, basePeriodo)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('amostras', async () => {
      await expect(service.amostras(noEmp, basePeriodo)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // vendas — estrutura e filtros
  // -------------------------------------------------------------------------

  describe('vendas', () => {
    it('retorna estrutura esperada (faturamento, porStatus, porRep)', async () => {
      prisma.pedido.aggregate
        .mockResolvedValueOnce(
          makeAggrResult({ _sum: { total: 5000 }, _count: { _all: 10 }, _avg: { total: 500 } }),
        )
        .mockResolvedValueOnce(makeAggrResult({ _sum: { total: 2500 }, _count: { _all: 5 } }))
        .mockResolvedValueOnce(makeAggrResult({ _sum: { total: 1000 }, _count: { _all: 2 } }));

      const result = await service.vendas(fakeUser(), basePeriodo);

      expect(result).toMatchObject({
        faturamento: {
          atual: expect.any(Number),
          anterior: expect.any(Number),
          variacao: expect.any(Number),
        },
        porStatus: expect.any(Array),
        porRep: expect.any(Array),
      });
    });

    it('calcula variação% corretamente — 5000 vs 2500 = +100%', async () => {
      prisma.pedido.aggregate
        .mockResolvedValueOnce(
          makeAggrResult({ _sum: { total: 5000 }, _count: { _all: 5 }, _avg: { total: 1000 } }),
        )
        .mockResolvedValueOnce(makeAggrResult({ _sum: { total: 2500 }, _count: { _all: 3 } }))
        .mockResolvedValueOnce(makeAggrResult({ _sum: { total: 3000 } }));

      const result = await service.vendas(fakeUser(), basePeriodo);

      expect(result.faturamento.variacao).toBe(100);
    });

    it('variação = 100 quando anterior é zero e atual > 0', async () => {
      prisma.pedido.aggregate
        .mockResolvedValueOnce(
          makeAggrResult({ _sum: { total: 1000 }, _count: { _all: 1 }, _avg: { total: 1000 } }),
        )
        .mockResolvedValueOnce(makeAggrResult({ _sum: { total: 0 }, _count: { _all: 0 } }))
        .mockResolvedValueOnce(makeAggrResult({ _sum: { total: 0 } }));

      const result = await service.vendas(fakeUser(), basePeriodo);

      expect(result.faturamento.variacao).toBe(100);
    });

    it('aplica empresaId nas queries de pedido', async () => {
      await service.vendas(fakeUser({ empresaIdAtiva: 'emp-7' }), basePeriodo);

      const firstAggCall = prisma.pedido.aggregate.mock.calls[0][0];
      expect(firstAggCall.where.empresaId).toBe('emp-7');
    });

    it('REP vê apenas os próprios pedidos (scope filter)', async () => {
      await service.vendas(fakeUser({ role: 'REP', id: 'rep-99' }), basePeriodo);

      const firstAggCall = prisma.pedido.aggregate.mock.calls[0][0];
      // REP scope retorna [user.id] → filtro { in: [id] }
      expect(firstAggCall.where.representanteId).toEqual({ in: ['rep-99'] });
    });

    it('GERENTE vê pedidos dos REPs sob gerência', async () => {
      await service.vendas(fakeUser({ role: 'GERENTE', id: 'ger-1' }), basePeriodo);

      const firstAggCall = prisma.pedido.aggregate.mock.calls[0][0];
      expect(firstAggCall.where.representanteId).toEqual({ in: ['rep-a', 'rep-b'] });
    });

    it('ADMIN não tem filtro de representanteId por padrão', async () => {
      await service.vendas(fakeUser({ role: 'ADMIN' }), basePeriodo);

      const firstAggCall = prisma.pedido.aggregate.mock.calls[0][0];
      expect(firstAggCall.where.representanteId).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // funil — estrutura
  // -------------------------------------------------------------------------

  describe('funil', () => {
    it('retorna estrutura esperada', async () => {
      const result = await service.funil(fakeUser(), basePeriodo);

      expect(result).toMatchObject({
        criados: expect.any(Object),
        ganhos: expect.any(Object),
        taxaConversao: expect.any(Number),
      });
    });

    it('aplica empresaId no filtro base', async () => {
      await service.funil(fakeUser({ empresaIdAtiva: 'emp-3' }), basePeriodo);

      // Todas as chamadas deve ter empresaId correto
      for (const call of prisma.lead.count.mock.calls) {
        expect(call[0].where.empresaId).toBe('emp-3');
      }
    });

    it('com funilId, usa as etapas do funil customizado (snapshot por funilEtapaId)', async () => {
      prisma.funil.findFirst.mockResolvedValueOnce({
        id: 'fun-1',
        etapas: [
          { id: 'et-novo', nome: 'Entrada', cor: '#111111', tipo: 'ATIVA' },
          { id: 'et-prop', nome: 'Proposta', cor: '#222222', tipo: 'ATIVA' },
          { id: 'et-fechado', nome: 'Fechado', cor: '#00ff00', tipo: 'GANHO' },
        ],
      });
      // 1ª chamada de groupBy = snapshot (agora por funilEtapaId).
      prisma.lead.groupBy.mockResolvedValueOnce([
        { funilEtapaId: 'et-novo', _count: { _all: 4 }, _sum: { valorEstimado: 1000 } },
        { funilEtapaId: 'et-fechado', _count: { _all: 1 }, _sum: { valorEstimado: 500 } },
      ]);

      const result = await service.funil(fakeUser(), { ...basePeriodo, funilId: 'fun-1' });

      // funilAtual segue a ORDEM das etapas do funil, com nome/cor e count 0 nas vazias.
      expect(result.funilAtual).toEqual([
        { etapa: 'et-novo', label: 'Entrada', cor: '#111111', count: 4, valorEstimado: 1000 },
        { etapa: 'et-prop', label: 'Proposta', cor: '#222222', count: 0, valorEstimado: 0 },
        { etapa: 'et-fechado', label: 'Fechado', cor: '#00ff00', count: 1, valorEstimado: 500 },
      ]);
      // totalAtivos conta só etapas tipo ATIVA → et-novo(4) + et-prop(0) = 4.
      expect(result.totalAtivos).toBe(4);
      // O filtro por funilId entra em TODAS as queries de lead.
      for (const call of prisma.lead.groupBy.mock.calls) {
        expect(call[0].where.funilId).toBe('fun-1');
      }
      for (const call of prisma.lead.count.mock.calls) {
        expect(call[0].where.funilId).toBe('fun-1');
      }
    });

    it('com funilId inexistente/de outra empresa → NotFoundException', async () => {
      prisma.funil.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.funil(fakeUser(), { ...basePeriodo, funilId: 'fun-inexistente' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // sac — estrutura e filtros
  // -------------------------------------------------------------------------

  describe('sac', () => {
    it('retorna estrutura esperada', async () => {
      const result = await service.sac(fakeUser(), basePeriodo);

      expect(result).toMatchObject({
        total: expect.objectContaining({ atual: expect.any(Number) }),
        abertas: expect.any(Number),
        resolvidas: expect.any(Number),
        porSeveridade: expect.any(Array),
      });
    });
  });

  // -------------------------------------------------------------------------
  // amostras — estrutura e filtros
  // -------------------------------------------------------------------------

  describe('amostras', () => {
    it('retorna estrutura esperada', async () => {
      const result = await service.amostras(fakeUser(), basePeriodo);

      expect(result).toMatchObject({
        total: expect.objectContaining({ atual: expect.any(Number) }),
        taxaConversao: expect.any(Number),
        valorConvertido: expect.any(Number),
      });
    });
  });

  // Fidelidade removida do projeto Betinna em 2026-05-21 (decisão R1 lote 3).
  // Tabelas no banco permanecem inalteradas — só endpoints/UI saíram.
});
