import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingService } from './pricing.service';

const makePrismaMock = () => ({
  produto: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  clientePrecoEspecial: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
});

const EMP = 'emp-1';

describe('PricingService (Sprint 2 — empresaId obrigatório)', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: PricingService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new PricingService(prisma as never);
  });

  describe('priceFor (produto sem cliente)', () => {
    it('retorna preço de tabela quando produto existe NA EMPRESA', async () => {
      prisma.produto.findFirst.mockResolvedValue({ id: 'p1', precoTabela: 100 });
      const r = await service.priceFor(EMP, 'p1');
      expect(r).toMatchObject({
        produtoId: 'p1',
        precoBase: 100,
        precoFinal: 100,
        descontoBase: 0,
        negociado: false,
        vigente: true,
      });
      // Confirma que filtrou por empresaId
      const where = prisma.produto.findFirst.mock.calls[0][0].where;
      expect(where.empresaId).toBe(EMP);
    });

    it('retorna null quando produto não existe NA EMPRESA (cross-tenant)', async () => {
      prisma.produto.findFirst.mockResolvedValue(null);
      expect(await service.priceFor(EMP, 'inexistente')).toBeNull();
    });

    it('lança erro quando empresaId vazio (defesa em profundidade)', async () => {
      await expect(service.priceFor('', 'p1')).rejects.toThrow(/empresaId obrigatório/);
    });
  });

  describe('priceForClient', () => {
    it('quando não há preço especial, retorna tabela', async () => {
      prisma.produto.findFirst.mockResolvedValue({ id: 'p1', precoTabela: 50 });
      prisma.clientePrecoEspecial.findFirst.mockResolvedValue(null);
      const r = await service.priceForClient(EMP, 'c1', 'p1');
      expect(r?.precoFinal).toBe(50);
      expect(r?.negociado).toBe(false);
    });

    it('aplica preço especial sem desconto', async () => {
      prisma.produto.findFirst.mockResolvedValue({ id: 'p1', precoTabela: 50 });
      prisma.clientePrecoEspecial.findFirst.mockResolvedValue({
        precoEspecial: 40,
        descontoBase: 0,
        validoAte: null,
      });
      const r = await service.priceForClient(EMP, 'c1', 'p1');
      expect(r?.precoFinal).toBe(40);
      expect(r?.negociado).toBe(true);
      expect(r?.vigente).toBe(true);
    });

    it('aplica preço especial + desconto base (10% de 40 = 36)', async () => {
      prisma.produto.findFirst.mockResolvedValue({ id: 'p1', precoTabela: 50 });
      prisma.clientePrecoEspecial.findFirst.mockResolvedValue({
        precoEspecial: 40,
        descontoBase: 10,
        validoAte: null,
      });
      const r = await service.priceForClient(EMP, 'c1', 'p1');
      expect(r?.precoFinal).toBe(36);
      expect(r?.descontoBase).toBe(10);
    });

    it('ignora preço especial fora da validade e volta pra tabela', async () => {
      prisma.produto.findFirst.mockResolvedValue({ id: 'p1', precoTabela: 50 });
      prisma.clientePrecoEspecial.findFirst.mockResolvedValue({
        precoEspecial: 40,
        descontoBase: 10,
        validoAte: new Date('2020-01-01'),
      });
      const r = await service.priceForClient(EMP, 'c1', 'p1', new Date('2026-01-01'));
      expect(r?.precoFinal).toBe(50);
      expect(r?.vigente).toBe(false);
      expect(r?.descontoBase).toBe(0);
    });

    it('mantém vigência se validoAte for futura', async () => {
      prisma.produto.findFirst.mockResolvedValue({ id: 'p1', precoTabela: 50 });
      prisma.clientePrecoEspecial.findFirst.mockResolvedValue({
        precoEspecial: 40,
        descontoBase: 0,
        validoAte: new Date('2099-12-31'),
      });
      const r = await service.priceForClient(EMP, 'c1', 'p1', new Date('2026-05-14'));
      expect(r?.vigente).toBe(true);
      expect(r?.precoFinal).toBe(40);
    });

    it('CROSS-TENANT BLOCK: produto de outra empresa retorna null', async () => {
      // Mock simula: findFirst com filtro empresa retorna null pq produto é de outra empresa
      prisma.produto.findFirst.mockResolvedValue(null);
      const r = await service.priceForClient(EMP, 'c1', 'produto-de-outra-emp');
      expect(r).toBeNull();
    });

    it('cliente de outra empresa: ClientePrecoEspecial findFirst retorna null (filtro cliente.empresaId)', async () => {
      // Produto existe na empresa, mas o cliente é de outra → precoEspecial filtra fora
      prisma.produto.findFirst.mockResolvedValue({ id: 'p1', precoTabela: 50 });
      prisma.clientePrecoEspecial.findFirst.mockResolvedValue(null);
      const r = await service.priceForClient(EMP, 'cliente-de-outra-emp', 'p1');
      // Cai pra tabela do produto (negociado=false)
      expect(r?.precoFinal).toBe(50);
      expect(r?.negociado).toBe(false);
      // Confirma que a query do clientePrecoEspecial filtrou por cliente.empresaId
      const where = prisma.clientePrecoEspecial.findFirst.mock.calls[0][0].where;
      expect(where.cliente.empresaId).toBe(EMP);
    });
  });

  describe('priceForClientBatch', () => {
    it('retorna mapa vazio para lista vazia', async () => {
      const r = await service.priceForClientBatch(EMP, 'c1', []);
      expect(r.size).toBe(0);
    });

    it('combina produtos com e sem preço negociado', async () => {
      prisma.produto.findMany.mockResolvedValue([
        { id: 'p1', precoTabela: 100 },
        { id: 'p2', precoTabela: 50 },
      ]);
      prisma.clientePrecoEspecial.findMany.mockResolvedValue([
        { produtoId: 'p1', precoEspecial: 80, descontoBase: 5, validoAte: null },
      ]);
      const r = await service.priceForClientBatch(EMP, 'c1', ['p1', 'p2']);
      expect(r.size).toBe(2);
      // p1: preço especial 80 com 5% desconto = 76
      expect(r.get('p1')?.precoFinal).toBe(76);
      expect(r.get('p1')?.negociado).toBe(true);
      // p2: sem negociação, preço tabela
      expect(r.get('p2')?.precoFinal).toBe(50);
      expect(r.get('p2')?.negociado).toBe(false);
      // Confirma filtros empresaId
      const produtoWhere = prisma.produto.findMany.mock.calls[0][0].where;
      expect(produtoWhere.empresaId).toBe(EMP);
      const especialWhere = prisma.clientePrecoEspecial.findMany.mock.calls[0][0].where;
      expect(especialWhere.cliente.empresaId).toBe(EMP);
    });

    it('lança erro quando empresaId vazio', async () => {
      await expect(service.priceForClientBatch('', 'c1', ['p1'])).rejects.toThrow(
        /empresaId obrigatório/,
      );
    });
  });
});
