import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type UserRole } from '@prisma/client';
import { ForbiddenException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ComissoesService } from './comissoes.service';

const makePrismaMock = () => ({
  comissao: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn(),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  pedido: { groupBy: vi.fn() },
  // Linhas de comissão por pedido — de onde sai a folha de SITE.
  pedidoComissao: {
    groupBy: vi.fn(async () => [] as unknown[]),
    findMany: vi.fn(async () => [] as unknown[]),
  },
  usuario: { findMany: vi.fn() },
  empresa: { findUnique: vi.fn(async (): Promise<{ config: unknown }> => ({ config: null })) },
  $transaction: vi.fn(async (ops: unknown[]) => {
    // Cada item é uma Promise dos `prisma.comissao.upsert(...)` retornadas
    return Promise.all(ops as Promise<unknown>[]);
  }),
});

const makeRepScope = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    if (u.role === 'GERENTE') return [];
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

describe('ComissoesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: ComissoesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new ComissoesService(
      prisma as never,
      makeRepScope() as never,
      {
        criarParaUsuario: vi.fn().mockResolvedValue(null),
        criarParaRole: vi.fn().mockResolvedValue(0),
      } as never,
      {
        enviarComissaoFechada: vi.fn().mockResolvedValue({ ok: true }),
        enviarBoasVindas: vi.fn().mockResolvedValue({ ok: true }),
        enviarAprovacaoResolvida: vi.fn().mockResolvedValue({ ok: true }),
        enviarOcorrenciaCritica: vi.fn().mockResolvedValue({ ok: true }),
        enviarAmostraFollowup: vi.fn().mockResolvedValue({ ok: true }),
      } as never,
      // Provisionamento no ERP: aqui é mock. O alvo destes testes é o CÁLCULO
      // da folha — o lançamento no financeiro tem spec própria.
      { provisionar: vi.fn().mockResolvedValue({}) } as never,
    );
    prisma.comissao.upsert.mockImplementation((args: { create: unknown }) =>
      Promise.resolve(args.create),
    );
  });

  describe('fecharMes', () => {
    it('retorna zeros quando não há pedidos comissionáveis', async () => {
      prisma.pedido.groupBy.mockResolvedValue([]);
      const out = await svc.fecharMes(fakeUser(), { mes: 4, ano: 2026, reprocessar: false });
      expect(out).toMatchObject({
        representantes: 0,
        gerentes: 0,
        totalVendas: 0,
        totalComissao: 0,
      });
    });

    it('CAÇADA-BUG #22: janela do mês no fuso BRT (00:00 BRT do dia 1 = 03:00 UTC)', async () => {
      prisma.pedido.groupBy.mockResolvedValue([]);
      await svc.fecharMes(fakeUser(), { mes: 7, ano: 2026, reprocessar: false });
      const where = prisma.pedido.groupBy.mock.calls[0][0].where;
      // Julho/2026: início 01/07 00:00 BRT = 01/07 03:00 UTC; fim 01/08 00:00 BRT = 01/08 03:00 UTC.
      expect((where.enviadoErpEm.gte as Date).toISOString()).toBe('2026-07-01T03:00:00.000Z');
      expect((where.enviadoErpEm.lt as Date).toISOString()).toBe('2026-08-01T03:00:00.000Z');
    });

    it('grava comissão REP por representanteId agregado', async () => {
      prisma.pedido.groupBy.mockResolvedValue([
        {
          representanteId: 'rep-1',
          _sum: { total: 10_000, comissao: 500 },
          _count: { _all: 4 },
        },
      ]);
      // findMany #1: repsConfig pra snapshot de percentual
      // findMany #2: reps com gerenteId
      prisma.usuario.findMany
        .mockResolvedValueOnce([{ id: 'rep-1', comissaoPadrao: 5 }])
        .mockResolvedValueOnce([{ id: 'rep-1', gerenteId: null }]);

      const out = await svc.fecharMes(fakeUser(), { mes: 4, ano: 2026, reprocessar: false });

      expect(out.representantes).toBe(1);
      expect(out.gerentes).toBe(0);
      expect(out.totalVendas).toBe(10_000);
      expect(out.totalComissao).toBe(500);

      const upsertCall = prisma.comissao.upsert.mock.calls[0][0];
      expect(upsertCall.create).toMatchObject({
        empresaId: 'emp-1',
        representanteId: 'rep-1',
        tipo: 'REP',
        totalVendas: 10_000,
        totalComissao: 500,
        qtdPedidos: 4,
        percentual: 5, // AUDITORIA P0-2: snapshot do comissaoPadrao
      });
    });

    it('CAÇADA-BUG #5: usa a comissaoPadrao do rep (8%), não o 5% hardcoded do pedido.comissao', async () => {
      // _sum.comissao vem 500 (5% hardcoded no create), mas o rep é configurado em 8% (D46).
      // A folha DEVE pagar 8% de 10.000 = 800, e o snapshot % = 8 (consistente).
      prisma.pedido.groupBy.mockResolvedValue([
        {
          representanteId: 'rep-1',
          _sum: { total: 10_000, comissao: 500 },
          _count: { _all: 4 },
        },
      ]);
      prisma.usuario.findMany
        .mockResolvedValueOnce([{ id: 'rep-1', comissaoPadrao: 8 }])
        .mockResolvedValueOnce([{ id: 'rep-1', gerenteId: null }]);

      const out = await svc.fecharMes(fakeUser(), { mes: 4, ano: 2026, reprocessar: false });

      expect(out.totalComissao).toBe(800); // 8% de 10.000, não 500
      expect(prisma.comissao.upsert.mock.calls[0][0].create).toMatchObject({
        totalComissao: 800,
        percentual: 8,
      });
    });

    it('#R7: reprocessar preserva o % congelado do snapshot (não a comissaoPadrao ATUAL)', async () => {
      // Rep fechou junho a 5% (snapshot percentual=5). Depois virou 8%. Reprocessar NÃO deve pagar 8%
      // com registro dizendo 5% — preserva o congelado (5%), consistente com o snapshot (igual GERENTE).
      prisma.pedido.groupBy.mockResolvedValue([
        {
          representanteId: 'rep-1',
          _sum: { total: 10_000, comissao: 500 },
          _count: { _all: 4 },
        },
      ]);
      prisma.usuario.findMany
        .mockResolvedValueOnce([{ id: 'rep-1', comissaoPadrao: 8 }]) // comissaoPadrao ATUAL = 8
        .mockResolvedValueOnce([{ id: 'rep-1', gerenteId: null }]);
      // existentesRep: snapshot congelado do fechamento original = 5%.
      prisma.comissao.findMany.mockResolvedValueOnce([{ representanteId: 'rep-1', percentual: 5 }]);

      const out = await svc.fecharMes(fakeUser(), { mes: 4, ano: 2026, reprocessar: true });

      // Paga 5% de 10.000 = 500 (congelado), não 800 (8% atual).
      expect(out.totalComissao).toBe(500);
      expect(prisma.comissao.upsert.mock.calls[0][0].update).toMatchObject({ totalComissao: 500 });
    });

    it('desconta estorno de devolução aprovada (líquido no mês do pedido)', async () => {
      prisma.pedido.groupBy.mockResolvedValue([
        {
          representanteId: 'rep-1',
          _sum: { total: 10_000, comissao: 500, comissaoEstornada: 100, valorDevolvido: 2_000 },
          _count: { _all: 4 },
        },
      ]);
      prisma.usuario.findMany
        .mockResolvedValueOnce([{ id: 'rep-1', comissaoPadrao: 5 }])
        .mockResolvedValueOnce([{ id: 'rep-1', gerenteId: null }]);

      const out = await svc.fecharMes(fakeUser(), { mes: 4, ano: 2026, reprocessar: false });

      // Vendas 10000 − 2000 devolvido = 8000; comissão 500 − 100 estornada = 400.
      expect(out.totalVendas).toBe(8_000);
      expect(out.totalComissao).toBe(400);
      expect(prisma.comissao.upsert.mock.calls[0][0].create).toMatchObject({
        totalVendas: 8_000,
        totalComissao: 400,
      });
    });

    it('escalonada por faturamento: comissão = vendas × % da faixa (não a soma por pedido)', async () => {
      prisma.pedido.groupBy.mockResolvedValue([
        {
          representanteId: 'rep-1',
          _sum: { total: 30_000, comissao: 999 }, // comissao por pedido é ignorado na escalonada
          _count: { _all: 6 },
        },
      ]);
      prisma.usuario.findMany
        .mockResolvedValueOnce([{ id: 'rep-1', comissaoPadrao: 5 }])
        .mockResolvedValueOnce([{ id: 'rep-1', gerenteId: null }]);
      prisma.empresa.findUnique.mockResolvedValue({
        config: {
          comissaoBonus: {
            modelo: 'escalonada_por_faturamento',
            faixas: [
              { de: 0, ate: 10000, percentual: 3 },
              { de: 10000.01, ate: 50000, percentual: 5 },
              { de: 50000.01, ate: null, percentual: 7 },
            ],
          },
        },
      });

      const out = await svc.fecharMes(fakeUser(), { mes: 4, ano: 2026, reprocessar: false });

      // 30.000 cai na faixa 5% → 1.500 (não 999 da soma por pedido)
      expect(out.totalComissao).toBe(1_500);
      const upsertCall = prisma.comissao.upsert.mock.calls[0][0];
      expect(upsertCall.create).toMatchObject({ totalComissao: 1_500, percentual: 5 });
    });

    it('calcula comissão do GERENTE somando vendas dos reps × comissaoPadrao', async () => {
      prisma.pedido.groupBy.mockResolvedValue([
        { representanteId: 'rep-1', _sum: { total: 10_000, comissao: 500 }, _count: { _all: 4 } },
        { representanteId: 'rep-2', _sum: { total: 20_000, comissao: 1_000 }, _count: { _all: 6 } },
      ]);
      // findMany #1: reps (com gerenteId), #2: gerentes
      prisma.usuario.findMany
        // #1 repsConfig pra snapshot de percentual REP
        .mockResolvedValueOnce([
          { id: 'rep-1', comissaoPadrao: 5 },
          { id: 'rep-2', comissaoPadrao: 5 },
        ])
        // #2 reps com gerenteId
        .mockResolvedValueOnce([
          { id: 'rep-1', gerenteId: 'ger-1' },
          { id: 'rep-2', gerenteId: 'ger-1' },
        ])
        // #3 gerentes
        .mockResolvedValueOnce([{ id: 'ger-1', comissaoPadrao: 2 }]);

      const out = await svc.fecharMes(fakeUser(), { mes: 4, ano: 2026, reprocessar: false });

      expect(out.gerentes).toBe(1);
      // 2 reps × 500/1000 = 1500 + gerente 2% sobre 30000 = 600 → 2100
      expect(out.totalComissao).toBe(2_100);

      const gerenteUpsert = prisma.comissao.upsert.mock.calls.find(
        (c: unknown[]) =>
          (c[0] as { create?: { representanteId?: string } }).create?.representanteId === 'ger-1',
      );
      expect((gerenteUpsert?.[0] as { create: unknown }).create).toMatchObject({
        tipo: 'GERENTE',
        percentual: 2,
        totalVendas: 30_000,
        totalComissao: 600,
        qtdPedidos: 0,
      });
    });

    it('ignora reps sem gerente na agregação de gerente', async () => {
      prisma.pedido.groupBy.mockResolvedValue([
        {
          representanteId: 'rep-orphan',
          _sum: { total: 5_000, comissao: 250 },
          _count: { _all: 2 },
        },
      ]);
      prisma.usuario.findMany
        .mockResolvedValueOnce([{ id: 'rep-orphan', comissaoPadrao: 5 }])
        .mockResolvedValueOnce([{ id: 'rep-orphan', gerenteId: null }]);

      const out = await svc.fecharMes(fakeUser(), { mes: 4, ano: 2026, reprocessar: false });
      expect(out.representantes).toBe(1);
      expect(out.gerentes).toBe(0);
      // 2 findMany (repsConfig + reps) — não há gerente pra buscar
      expect(prisma.usuario.findMany).toHaveBeenCalledTimes(2);
    });

    it('fecha SITE mesmo sem NENHUM pedido de rep no mês', async () => {
      // Venda de canal não tem representante — não aparece no groupBy de Pedido.
      // Antes disso o método saía no early return e a comissão de site sumia.
      prisma.pedido.groupBy.mockResolvedValue([]);
      prisma.usuario.findMany.mockResolvedValue([]);
      prisma.pedidoComissao.groupBy.mockResolvedValue([
        {
          usuarioId: 'leo',
          percentual: 7.25,
          _sum: { base: new Prisma.Decimal('1000.00'), valor: new Prisma.Decimal('72.50') },
          _count: { _all: 2 },
        },
      ]);
      prisma.pedidoComissao.findMany.mockResolvedValue([
        { base: new Prisma.Decimal('600.00') },
        { base: new Prisma.Decimal('400.00') },
      ]);

      const out = await svc.fecharMes(fakeUser(), { mes: 4, ano: 2026, reprocessar: false });

      expect(out.site).toBe(1);
      expect(out.totalVendas).toBe(1_000);
      expect(out.totalComissao).toBe(72.5);
      const siteUpsert = prisma.comissao.upsert.mock.calls.find(
        (c: unknown[]) => (c[0] as { create?: { tipo?: string } }).create?.tipo === 'SITE',
      );
      expect((siteUpsert?.[0] as { create: unknown }).create).toMatchObject({
        representanteId: 'leo',
        tipo: 'SITE',
        // A % configurada, exata — não a razão arredondada entre centavos.
        percentual: 7.25,
        totalVendas: 1_000,
        totalComissao: 72.5,
        qtdPedidos: 2,
      });
    });

    it('duas pessoas no MESMO pedido: vendas contadas uma vez, % de quem mudou vira efetiva', async () => {
      prisma.pedido.groupBy.mockResolvedValue([]);
      prisma.usuario.findMany.mockResolvedValue([]);
      // Um pedido de R$50 com dois beneficiários; o segundo trocou de 5% pra
      // 7,25% no meio do mês (dois grupos pra ele).
      const D = (v: string) => new Prisma.Decimal(v);
      prisma.pedidoComissao.groupBy.mockResolvedValue([
        {
          usuarioId: 'teste',
          percentual: 7.25,
          _sum: { base: D('50'), valor: D('3.63') },
          _count: { _all: 1 },
        },
        {
          usuarioId: 'harada',
          percentual: 5,
          _sum: { base: D('30'), valor: D('1.50') },
          _count: { _all: 1 },
        },
        {
          usuarioId: 'harada',
          percentual: 7.25,
          _sum: { base: D('20'), valor: D('1.45') },
          _count: { _all: 1 },
        },
      ]);
      // distinct por pedido: o site vendeu R$50, não R$100.
      prisma.pedidoComissao.findMany.mockResolvedValue([{ base: D('50') }]);

      const out = await svc.fecharMes(fakeUser(), { mes: 4, ano: 2026, reprocessar: false });

      expect(out.site).toBe(2);
      expect(out.totalVendas).toBe(50);
      expect(out.totalComissao).toBe(6.58);
      const harada = prisma.comissao.upsert.mock.calls
        .map((c: unknown[]) => (c[0] as { create: Record<string, unknown> }).create)
        .find((c) => c.representanteId === 'harada');
      // 2,95 / 50 = 5,9% — efetiva, porque a % configurada não foi uma só no mês.
      expect(harada).toMatchObject({
        tipo: 'SITE',
        percentual: 5.9,
        totalVendas: 50,
        totalComissao: 2.95,
        qtdPedidos: 2,
      });
    });

    it('reprocessar remove da folha quem não tem mais venda (pedido cancelado)', async () => {
      // Só o TESTE ainda tem linha; a do Harada (venda cancelada) tem que sair.
      prisma.pedido.groupBy.mockResolvedValue([]);
      prisma.usuario.findMany.mockResolvedValue([]);
      prisma.pedidoComissao.groupBy.mockResolvedValue([
        {
          usuarioId: 'teste',
          percentual: 7.25,
          _sum: { base: new Prisma.Decimal('50'), valor: new Prisma.Decimal('3.63') },
          _count: { _all: 1 },
        },
      ]);
      prisma.pedidoComissao.findMany.mockResolvedValue([{ base: new Prisma.Decimal('50') }]);

      await svc.fecharMes(fakeUser(), { mes: 9, ano: 2026, reprocessar: true });

      expect(prisma.comissao.deleteMany).toHaveBeenCalledWith({
        where: {
          empresaId: 'emp-1',
          mes: 9,
          ano: 2026,
          pago: false,
          NOT: [{ representanteId: 'teste', tipo: 'SITE' }],
        },
      });
    });

    it('reprocessar um mês que ficou SEM venda zera a folha (menos o que já foi pago)', async () => {
      prisma.pedido.groupBy.mockResolvedValue([]);
      prisma.pedidoComissao.groupBy.mockResolvedValue([]);

      const out = await svc.fecharMes(fakeUser(), { mes: 9, ano: 2026, reprocessar: true });

      expect(out.site).toBe(0);
      expect(prisma.comissao.deleteMany).toHaveBeenCalledWith({
        where: { empresaId: 'emp-1', mes: 9, ano: 2026, pago: false },
      });
    });

    it('GERENTE não fecha SITE — canal não pertence à gerência dele', async () => {
      prisma.pedido.groupBy.mockResolvedValue([]);
      prisma.pedidoComissao.groupBy.mockResolvedValue([
        {
          usuarioId: 'leo',
          percentual: 7.25,
          _sum: { base: new Prisma.Decimal('1000.00'), valor: new Prisma.Decimal('72.50') },
          _count: { _all: 1 },
        },
      ]);

      const out = await svc.fecharMes(fakeUser({ role: 'GERENTE' as UserRole }), {
        mes: 4,
        ano: 2026,
        reprocessar: false,
      });

      expect(out.site).toBe(0);
      expect(prisma.pedidoComissao.groupBy).not.toHaveBeenCalled();
    });

    it('soma _sum do Pedido como Prisma.Decimal sem virar string — #17 Fase 2', async () => {
      // Pós-migração, Pedido.total/comissao são Decimal — o aggregate _sum vem Decimal.
      // Prova que totalVendasAgg/totalComissaoAgg somam de verdade (não concatenam).
      prisma.pedido.groupBy.mockResolvedValue([
        {
          representanteId: 'rep-1',
          _sum: { total: new Prisma.Decimal('10000.50'), comissao: new Prisma.Decimal('500.25') },
          _count: { _all: 4 },
        },
        {
          representanteId: 'rep-2',
          _sum: { total: new Prisma.Decimal('20000.50'), comissao: new Prisma.Decimal('1000.75') },
          _count: { _all: 6 },
        },
      ]);
      prisma.usuario.findMany
        .mockResolvedValueOnce([
          { id: 'rep-1', comissaoPadrao: 5 },
          { id: 'rep-2', comissaoPadrao: 5 },
        ])
        .mockResolvedValueOnce([
          { id: 'rep-1', gerenteId: null },
          { id: 'rep-2', gerenteId: null },
        ]);

      const out = await svc.fecharMes(fakeUser(), { mes: 4, ano: 2026, reprocessar: false });

      // 10000.50 + 20000.50 = 30001 (número, não "10000.520000.5")
      expect(out.totalVendas).toBe(30_001);
      // #5: folha = vendas líquidas × comissaoPadrao (5%), não mais Σ pedido.comissao.
      // 500.03 (10000.50×5% arred.) + 1000.03 (20000.50×5% arred.) = 1500.06 — soma numérica.
      expect(out.totalComissao).toBe(1_500.06);
      expect(typeof out.totalVendas).toBe('number');

      // O write da Comissao recebe number (Prisma coage pra Decimal na gravação).
      const upsertRep1 = prisma.comissao.upsert.mock.calls.find(
        (c: unknown[]) =>
          (c[0] as { create?: { representanteId?: string } }).create?.representanteId === 'rep-1',
      );
      expect((upsertRep1?.[0] as { create: { totalVendas: unknown } }).create.totalVendas).toBe(
        10_000.5,
      );
    });
  });

  describe('resumoDoRep', () => {
    it('aceita GERENTE consultando o próprio resumo', async () => {
      prisma.comissao.findMany.mockResolvedValue([]);
      await expect(
        svc.resumoDoRep(fakeUser({ id: 'ger-1', role: 'GERENTE' as UserRole })),
      ).resolves.toBeDefined();
    });

    it('rejeita SAC', async () => {
      await expect(svc.resumoDoRep(fakeUser({ role: 'SAC' as UserRole }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('soma corretamente com Prisma.Decimal (não concatena string) — #17', async () => {
      const ano = new Date().getFullYear();
      prisma.comissao.findMany.mockResolvedValue([
        {
          ano,
          pago: true,
          totalComissao: new Prisma.Decimal('250.50'),
          totalVendas: new Prisma.Decimal('5000'),
        },
        {
          ano,
          pago: true,
          totalComissao: new Prisma.Decimal('100.25'),
          totalVendas: new Prisma.Decimal('2000'),
        },
        {
          ano,
          pago: false,
          totalComissao: new Prisma.Decimal('40.10'),
          totalVendas: new Prisma.Decimal('800'),
        },
      ]);

      const r = (await svc.resumoDoRep(fakeUser({ id: 'rep-1', role: 'REP' as UserRole }))) as {
        totalRecebidoAnoAtual: number;
        totalAReceberAnoAtual: number;
      };

      expect(r.totalRecebidoAnoAtual).toBe(350.75);
      expect(r.totalAReceberAnoAtual).toBe(40.1);
    });

    it('CAÇADA-BUG #26: totais anuais somam TODOS os lançamentos do ano (não só os 12 recentes)', async () => {
      const ano = new Date().getFullYear();
      const rec = (v: number, pago: boolean) => ({
        ano,
        pago,
        totalComissao: new Prisma.Decimal(v),
      });
      // 1ª findMany = histórico exibido (take 12); 2ª = registrosDoAno (ano inteiro: REP+GERENTE = 15).
      prisma.comissao.findMany
        .mockResolvedValueOnce(Array.from({ length: 12 }, () => rec(10, true)))
        .mockResolvedValueOnce([...Array.from({ length: 14 }, () => rec(10, true)), rec(5, false)]);

      const r = (await svc.resumoDoRep(fakeUser({ id: 'rep-1', role: 'REP' as UserRole }))) as {
        totalRecebidoAnoAtual: number;
        totalAReceberAnoAtual: number;
      };

      // 14×10 = 140 recebido (não 120 dos 12 do histórico), 5 a receber.
      expect(r.totalRecebidoAnoAtual).toBe(140);
      expect(r.totalAReceberAnoAtual).toBe(5);
    });
  });

  describe('list — rep scope', () => {
    it('REP vê só as próprias comissões', async () => {
      prisma.comissao.count.mockResolvedValue(0);
      prisma.comissao.findMany.mockResolvedValue([]);
      await svc.list(fakeUser({ id: 'rep-7', role: 'REP' as UserRole }), {
        page: 1,
        limit: 10,
      });
      const where = prisma.comissao.findMany.mock.calls[0][0].where;
      expect(where.representanteId).toEqual({ in: ['rep-7'] });
    });
  });

  describe('multi-tenant (auditoria 2026-05-15 P0-1)', () => {
    it('DIRECTOR fica restrito à própria empresa (filtra empresaId)', async () => {
      prisma.comissao.count.mockResolvedValue(0);
      prisma.comissao.findMany.mockResolvedValue([]);
      await svc.list(fakeUser({ role: 'DIRECTOR' as UserRole, empresaIdAtiva: 'emp-2' }), {
        page: 1,
        limit: 10,
      });
      const where = prisma.comissao.findMany.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-2');
    });

    it('ADMIN é escopado pela empresa ATIVA (não vê todas misturadas)', async () => {
      prisma.comissao.count.mockResolvedValue(0);
      prisma.comissao.findMany.mockResolvedValue([]);
      await svc.list(fakeUser({ role: 'ADMIN' as UserRole, empresaIdAtiva: 'emp-9' }), {
        page: 1,
        limit: 10,
      });
      const where = prisma.comissao.findMany.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-9');
    });

    it('GERENTE filtra empresaId E reps sob gerência', async () => {
      const repScope = makeRepScope();
      repScope.getRepIds.mockResolvedValue(['rep-a', 'rep-b']);
      svc = new ComissoesService(
        prisma as never,
        repScope as never,
        {
          criarParaUsuario: vi.fn().mockResolvedValue(null),
          criarParaRole: vi.fn().mockResolvedValue(0),
        } as never,
        {
          enviarComissaoFechada: vi.fn().mockResolvedValue({ ok: true }),
          enviarBoasVindas: vi.fn().mockResolvedValue({ ok: true }),
          enviarAprovacaoResolvida: vi.fn().mockResolvedValue({ ok: true }),
          enviarOcorrenciaCritica: vi.fn().mockResolvedValue({ ok: true }),
          enviarAmostraFollowup: vi.fn().mockResolvedValue({ ok: true }),
        } as never,
        { provisionar: vi.fn().mockResolvedValue({}) } as never,
      );
      prisma.comissao.count.mockResolvedValue(0);
      prisma.comissao.findMany.mockResolvedValue([]);
      await svc.list(fakeUser({ role: 'GERENTE' as UserRole, empresaIdAtiva: 'emp-1' }), {
        page: 1,
        limit: 10,
      });
      const where = prisma.comissao.findMany.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-1');
      expect(where.representanteId).toEqual({ in: ['rep-a', 'rep-b'] });
    });
  });

  describe('marcarPago — idempotente (auditoria P0-4)', () => {
    it('updateMany com pago=false condicional — count===0 lança BusinessRule', async () => {
      // findById → comissão existente
      prisma.comissao.findFirst = vi.fn().mockResolvedValue({
        id: 'com-1',
        representanteId: 'rep-1',
        pago: true,
      });
      prisma.comissao.updateMany = vi.fn().mockResolvedValue({ count: 0 });

      const { BusinessRuleException } = await import('@shared/errors/app-exception');
      await expect(
        svc.marcarPago(fakeUser(), 'com-1', { reciboUrl: 'http://x' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      // Confirma que o where filtrou por pago: false (proteção race condition)
      const callArgs = (prisma.comissao.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.where.pago).toBe(false);
    });
  });
});
