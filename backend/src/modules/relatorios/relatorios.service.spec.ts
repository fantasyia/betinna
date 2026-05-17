import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { ForbiddenException } from '@shared/errors/app-exception';
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
  movimentoFidelidade: {
    groupBy: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  saldoFidelidade: {
    aggregate: vi.fn().mockResolvedValue({ _sum: { pontos: null }, _count: { _all: 0 } }),
    findMany: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  programaFidelidade: {
    findUnique: vi.fn().mockResolvedValue(null),
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

  // -------------------------------------------------------------------------
  // fidelidade — estrutura, taxa de uso e top clientes
  // -------------------------------------------------------------------------

  describe('fidelidade', () => {
    it('retorna estrutura zero quando não há movimentos', async () => {
      const result = await service.fidelidade(fakeUser(), basePeriodo);

      expect(result).toMatchObject({
        programaAtivo: false,
        clientesNoPrograma: 0,
        saldoTotal: 0,
        noPeriodo: {
          creditados: 0,
          resgatados: 0,
          estornados: 0,
          expirados: 0,
          ajustados: 0,
          totalMovimentos: 0,
        },
        taxaUso: 0,
        topClientes: [],
      });
    });

    it('calcula taxaUso = resgatados/creditados e top clientes', async () => {
      prisma.movimentoFidelidade.groupBy.mockResolvedValue([
        { tipo: 'GANHO_PEDIDO', _sum: { pontos: 1000 }, _count: { _all: 5 } },
        { tipo: 'RESGATE', _sum: { pontos: -250 }, _count: { _all: 2 } },
        { tipo: 'EXPIRACAO', _sum: { pontos: -50 }, _count: { _all: 1 } },
      ]);
      prisma.saldoFidelidade.aggregate.mockResolvedValue({
        _sum: { pontos: 700 },
        _count: { _all: 3 },
      });
      prisma.saldoFidelidade.findMany.mockResolvedValue([
        { pontos: 400, cliente: { id: 'c1', nome: 'Cli A' } },
        { pontos: 300, cliente: { id: 'c2', nome: 'Cli B' } },
      ]);
      prisma.programaFidelidade.findUnique.mockResolvedValue({ ativo: true });

      const result = await service.fidelidade(fakeUser(), basePeriodo);

      expect(result.programaAtivo).toBe(true);
      expect(result.saldoTotal).toBe(700);
      expect(result.clientesNoPrograma).toBe(3);
      expect(result.noPeriodo.creditados).toBe(1000);
      expect(result.noPeriodo.resgatados).toBe(250);
      expect(result.noPeriodo.expirados).toBe(50);
      expect(result.taxaUso).toBe(25);
      expect(result.topClientes).toHaveLength(2);
      expect(result.topClientes[0]?.cliente.nome).toBe('Cli A');
    });

    it('taxaUso = 0 quando não há créditos no período', async () => {
      prisma.movimentoFidelidade.groupBy.mockResolvedValue([
        { tipo: 'RESGATE', _sum: { pontos: -100 }, _count: { _all: 1 } },
      ]);

      const result = await service.fidelidade(fakeUser(), basePeriodo);
      expect(result.taxaUso).toBe(0);
    });
  });
});
