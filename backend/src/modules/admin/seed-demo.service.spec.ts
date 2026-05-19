import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SeedDemoService } from './seed-demo.service';

/**
 * Specs do SeedDemoService — testes leves de smoke + comportamento crítico.
 *
 * Foco:
 *  - run() sempre chama wipe() antes (idempotência)
 *  - run() rejeita multiplier fora da faixa [0.1, 5]
 *  - status() agrega contagens dos 8 modelos
 *  - wipe() filtra SEMPRE por isDemo=true (jamais toca dado real)
 *
 * Não rodamos createMany real aqui — mockamos Prisma. Testes de integração
 * com dataset completo são feitos via endpoint admin em ambiente staging.
 */

const makePrismaMock = () => {
  const countResolvers = {
    cliente: vi.fn().mockResolvedValue(0),
    produto: vi.fn().mockResolvedValue(0),
    pedido: vi.fn().mockResolvedValue(0),
    proposta: vi.fn().mockResolvedValue(0),
    amostra: vi.fn().mockResolvedValue(0),
    comissao: vi.fn().mockResolvedValue(0),
    conversation: vi.fn().mockResolvedValue(0),
    respostaNPS: vi.fn().mockResolvedValue(0),
  };
  const deleteManyResolvers = {
    cliente: vi.fn().mockResolvedValue({ count: 0 }),
    produto: vi.fn().mockResolvedValue({ count: 0 }),
    pedido: vi.fn().mockResolvedValue({ count: 0 }),
    proposta: vi.fn().mockResolvedValue({ count: 0 }),
    amostra: vi.fn().mockResolvedValue({ count: 0 }),
    comissao: vi.fn().mockResolvedValue({ count: 0 }),
    conversation: vi.fn().mockResolvedValue({ count: 0 }),
    respostaNPS: vi.fn().mockResolvedValue({ count: 0 }),
    pesquisaNPS: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const createManyResolvers = {
    cliente: vi.fn().mockResolvedValue({ count: 50 }),
    produto: vi.fn().mockResolvedValue({ count: 200 }),
    amostra: vi.fn().mockResolvedValue({ count: 20 }),
    respostaNPS: vi.fn().mockResolvedValue({ count: 100 }),
    comissao: vi.fn().mockResolvedValue({ count: 9 }),
  };

  return {
    empresa: {
      findUnique: vi.fn().mockResolvedValue({ id: 'emp-1', nome: 'Empresa Demo' }),
    },
    cliente: {
      count: countResolvers.cliente,
      createMany: createManyResolvers.cliente,
      deleteMany: deleteManyResolvers.cliente,
      findMany: vi.fn().mockResolvedValue([
        { id: 'cli-1', nome: 'Cliente A' },
        { id: 'cli-2', nome: 'Cliente B' },
      ]),
    },
    produto: {
      count: countResolvers.produto,
      createMany: createManyResolvers.produto,
      deleteMany: deleteManyResolvers.produto,
      findMany: vi.fn().mockResolvedValue([
        { id: 'prod-1', nome: 'Produto A', precoTabela: 10, sku: 'SKU-A' },
        { id: 'prod-2', nome: 'Produto B', precoTabela: 20, sku: 'SKU-B' },
      ]),
    },
    pedido: {
      count: countResolvers.pedido,
      create: vi.fn().mockResolvedValue({ id: 'ped-1' }),
      deleteMany: deleteManyResolvers.pedido,
    },
    proposta: {
      count: countResolvers.proposta,
      create: vi.fn().mockResolvedValue({ id: 'prop-1' }),
      deleteMany: deleteManyResolvers.proposta,
    },
    amostra: {
      count: countResolvers.amostra,
      createMany: createManyResolvers.amostra,
      deleteMany: deleteManyResolvers.amostra,
    },
    comissao: {
      count: countResolvers.comissao,
      createMany: createManyResolvers.comissao,
      deleteMany: deleteManyResolvers.comissao,
    },
    conversation: {
      count: countResolvers.conversation,
      create: vi.fn().mockResolvedValue({ id: 'conv-1' }),
      deleteMany: deleteManyResolvers.conversation,
    },
    respostaNPS: {
      count: countResolvers.respostaNPS,
      createMany: createManyResolvers.respostaNPS,
      deleteMany: deleteManyResolvers.respostaNPS,
    },
    pesquisaNPS: {
      upsert: vi.fn().mockResolvedValue({ id: 'pesq-1' }),
      deleteMany: deleteManyResolvers.pesquisaNPS,
    },
    usuario: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'rep-1', nome: 'Rep A', comissaoPadrao: 5 },
        { id: 'rep-2', nome: 'Rep B', comissaoPadrao: 5 },
        { id: 'rep-3', nome: 'Rep C', comissaoPadrao: 5 },
      ]),
    },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
};

describe('SeedDemoService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: SeedDemoService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new SeedDemoService(prisma as never);
  });

  describe('status', () => {
    it('agrega contagens dos 8 modelos com isDemo=true', async () => {
      prisma.cliente.count.mockResolvedValue(50);
      prisma.produto.count.mockResolvedValue(200);
      prisma.pedido.count.mockResolvedValue(300);
      prisma.proposta.count.mockResolvedValue(50);
      prisma.amostra.count.mockResolvedValue(20);
      prisma.comissao.count.mockResolvedValue(9);
      prisma.conversation.count.mockResolvedValue(30);
      prisma.respostaNPS.count.mockResolvedValue(100);

      const res = await svc.status('emp-1');

      expect(res.empresaId).toBe('emp-1');
      expect(res.total).toBe(759);
      expect(res.detail.clientes).toBe(50);
      expect(res.detail.produtos).toBe(200);
    });

    it('todas as queries de count filtram por isDemo=true', async () => {
      await svc.status('emp-1');

      for (const model of [
        prisma.cliente,
        prisma.produto,
        prisma.pedido,
        prisma.proposta,
        prisma.amostra,
        prisma.comissao,
        prisma.conversation,
      ]) {
        const where = model.count.mock.calls[0][0].where;
        expect(where.isDemo).toBe(true);
      }
    });

    it('lança NotFoundException quando empresa não existe', async () => {
      prisma.empresa.findUnique.mockResolvedValue(null);
      await expect(svc.status('inexistente')).rejects.toThrow();
    });
  });

  describe('wipe', () => {
    it('deleta APENAS isDemo=true (jamais dado real)', async () => {
      await svc.wipe('emp-1');

      // Toda query de deleteMany deve incluir isDemo: true no where
      const deleteCalls = [
        prisma.cliente.deleteMany.mock.calls[0][0],
        prisma.produto.deleteMany.mock.calls[0][0],
        prisma.pedido.deleteMany.mock.calls[0][0],
        prisma.proposta.deleteMany.mock.calls[0][0],
        prisma.amostra.deleteMany.mock.calls[0][0],
        prisma.comissao.deleteMany.mock.calls[0][0],
        prisma.conversation.deleteMany.mock.calls[0][0],
      ];
      for (const call of deleteCalls) {
        expect(call.where.isDemo).toBe(true);
        expect(call.where.empresaId).toBe('emp-1');
      }
    });

    it('respostaNPS é deletada via filtro pesquisa.empresaId', async () => {
      await svc.wipe('emp-1');

      const call = prisma.respostaNPS.deleteMany.mock.calls[0][0];
      expect(call.where.isDemo).toBe(true);
      expect(call.where.pesquisa.empresaId).toBe('emp-1');
    });
  });

  describe('run', () => {
    it('rejeita multiplier fora de [0.1, 5]', async () => {
      await expect(svc.run('emp-1', 0)).rejects.toThrow(/multiplier/);
      await expect(svc.run('emp-1', 10)).rejects.toThrow(/multiplier/);
    });

    it('chama wipe ANTES de seedar (idempotência)', async () => {
      await svc.run('emp-1', 0.1); // multiplier baixo pra rodar rápido

      expect(prisma.cliente.deleteMany).toHaveBeenCalled();
      expect(prisma.cliente.createMany).toHaveBeenCalled();
      // Ordem: deleteMany invocado antes do createMany no order de invocação
      const deleteOrder =
        prisma.cliente.deleteMany.mock.invocationCallOrder[0];
      const createOrder =
        prisma.cliente.createMany.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(createOrder);
    });

    it('todos os createMany recebem isDemo=true em cada record', async () => {
      await svc.run('emp-1', 0.1);

      const clientesData = prisma.cliente.createMany.mock.calls[0][0].data as Array<{ isDemo: boolean }>;
      const produtosData = prisma.produto.createMany.mock.calls[0][0].data as Array<{ isDemo: boolean }>;
      const amostrasData = prisma.amostra.createMany.mock.calls[0][0].data as Array<{ isDemo: boolean }>;
      const respostasData = prisma.respostaNPS.createMany.mock.calls[0][0].data as Array<{ isDemo: boolean }>;
      const comissoesData = prisma.comissao.createMany.mock.calls[0][0].data as Array<{ isDemo: boolean }>;

      expect(clientesData.every((c) => c.isDemo === true)).toBe(true);
      expect(produtosData.every((p) => p.isDemo === true)).toBe(true);
      expect(amostrasData.every((a) => a.isDemo === true)).toBe(true);
      expect(respostasData.every((r) => r.isDemo === true)).toBe(true);
      expect(comissoesData.every((c) => c.isDemo === true)).toBe(true);
    });

    it('escala dataset pelo multiplier', async () => {
      await svc.run('emp-1', 0.5); // metade

      const clientesData = prisma.cliente.createMany.mock.calls[0][0].data as unknown[];
      expect(clientesData.length).toBe(25); // 50 * 0.5
      const produtosData = prisma.produto.createMany.mock.calls[0][0].data as unknown[];
      expect(produtosData.length).toBe(100); // 200 * 0.5
    });

    it('retorna detalhamento das contagens criadas', async () => {
      const res = await svc.run('emp-1', 1);

      expect(res.clientes).toBe(50);
      expect(res.produtos).toBe(200);
      expect(res.amostras).toBe(20);
      expect(res.respostasNps).toBe(100);
      expect(res.comissoes).toBe(9); // 3 reps × 3 meses
    });
  });
});
