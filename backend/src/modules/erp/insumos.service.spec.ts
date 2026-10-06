import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { InsumosController } from './insumos.controller';
import { movimentoInsumoSchema } from './insumos.dto';
import { InsumosService, novoCustoMedio } from './insumos.service';

const user = { id: 'u-1', role: 'DIRECTOR', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] };

const insumo = (over: Record<string, unknown> = {}) => ({
  id: 'ins-1',
  empresaId: 'emp-1',
  nome: 'Moletom 3 cabos',
  tipo: 'TECIDO',
  unidade: 'KG',
  cor: 'Preto',
  fornecedor: null,
  custoMedio: new Prisma.Decimal(40),
  estoqueMinimo: new Prisma.Decimal(10),
  ativo: true,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
  ...over,
});

function montar(opts: { ligado?: boolean; saldo?: number; movs?: number } = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ custoMedio: new Prisma.Decimal(40) }]),
    insumoMovimento: {
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { quantidade: new Prisma.Decimal(opts.saldo ?? 0) } }),
      create: vi.fn().mockResolvedValue({}),
    },
    insumo: { update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    insumo: {
      findFirst: vi.fn().mockResolvedValue(insumo()),
      findMany: vi.fn().mockResolvedValue([insumo()]),
      create: vi.fn().mockResolvedValue(insumo()),
      update: vi.fn().mockResolvedValue(insumo()),
      delete: vi.fn().mockResolvedValue({}),
    },
    insumoMovimento: {
      groupBy: vi
        .fn()
        .mockResolvedValue([
          { insumoId: 'ins-1', _sum: { quantidade: new Prisma.Decimal(opts.saldo ?? 0) } },
        ]),
      count: vi.fn().mockResolvedValue(opts.movs ?? 0),
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const erp = {
    empresaLigada: vi.fn(async () => {
      if (opts.ligado === false) throw new BusinessRuleException('desligado');
      return 'emp-1';
    }),
  };
  return { svc: new InsumosService(prisma as never, erp as never), prisma, tx };
}

describe('custo médio ponderado', () => {
  it('20 kg a R$ 40 + 10 kg a R$ 46 = R$ 42/kg', () => {
    expect(novoCustoMedio(20, 40, 10, 46)).toBeCloseTo(42, 6);
  });
  it('sem saldo: o custo é o da compra', () => {
    expect(novoCustoMedio(0, 40, 10, 46)).toBe(46);
  });
  it('saldo negativo (gastou antes de lançar a compra) não puxa a média', () => {
    expect(novoCustoMedio(-5, 40, 10, 46)).toBe(46);
  });
});

describe('InsumosService', () => {
  it('só ADMIN e DIRECTOR passam pelo controller', () => {
    const roles = new Reflector().get<string[]>('roles', InsumosController);
    expect([...roles].sort()).toEqual(['ADMIN', 'DIRECTOR']);
  });

  it('ERP desligado: recusa sem ler nada', async () => {
    const { svc, prisma } = montar({ ligado: false });
    await expect(svc.listar(user as never)).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.insumo.findMany).not.toHaveBeenCalled();
  });

  it('lista com saldo, valor em estoque e alerta de reposição', async () => {
    const { svc } = montar({ saldo: 8 });
    const [i] = await svc.listar(user as never);
    expect(i).toMatchObject({ saldo: 8, custoMedio: 40, valorEmEstoque: 320, repor: true });
  });

  it('compra: grava ENTRADA_COMPRA e o custo médio novo, sob lock da linha', async () => {
    const { svc, tx } = montar({ saldo: 20 });
    await svc.comprar(user as never, 'ins-1', {
      quantidade: 10,
      custoUnitario: 46,
      documento: 'NF 123',
      motivo: null,
    });
    expect(String(tx.$queryRaw.mock.calls[0][0].join('?'))).toContain('FOR UPDATE');
    expect(tx.insumoMovimento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tipo: 'ENTRADA_COMPRA', documento: 'NF 123' }),
    });
    expect(Number(tx.insumo.update.mock.calls[0][0].data.custoMedio)).toBe(42);
  });

  it('perda sai com sinal negativo; sobra entra positiva; custo não muda', async () => {
    const { svc, prisma } = montar();
    await svc.movimentar(user as never, 'ins-1', {
      tipo: 'PERDA',
      quantidade: 1.5,
      motivo: 'rasgou',
      documento: null,
    });
    await svc.movimentar(user as never, 'ins-1', {
      tipo: 'SOBRA_RETORNO',
      quantidade: 0.8,
      motivo: 'sobra do corte',
      documento: null,
    });
    const qs = prisma.insumoMovimento.create.mock.calls.map((c) => Number(c[0].data.quantidade));
    expect(qs).toEqual([-1.5, 0.8]);
    expect(prisma.insumo.update).not.toHaveBeenCalled();
  });

  it('trocar a unidade de insumo COM histórico: recusa', async () => {
    const { svc, prisma } = montar({ movs: 3 });
    await expect(
      svc.atualizar(user as never, 'ins-1', {
        nome: 'Moletom',
        tipo: 'TECIDO',
        unidade: 'METRO',
        cor: null,
        fornecedor: null,
      }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.insumo.update).not.toHaveBeenCalled();
  });

  it('excluir insumo com histórico: recusa (desative)', async () => {
    const { svc, prisma } = montar({ movs: 1 });
    await expect(svc.excluir(user as never, 'ins-1')).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.insumo.delete).not.toHaveBeenCalled();
  });

  it('insumo de OUTRA empresa: 404', async () => {
    const { svc, prisma } = montar();
    prisma.insumo.findFirst.mockResolvedValue(null);
    await expect(
      svc.comprar(user as never, 'ins-x', {
        quantidade: 1,
        custoUnitario: 1,
        documento: null,
        motivo: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DTO: perda/sobra só positivas; motivo obrigatório', () => {
    const base = { tipo: 'PERDA', quantidade: 2, motivo: 'rasgou' };
    expect(movimentoInsumoSchema.safeParse(base).success).toBe(true);
    expect(movimentoInsumoSchema.safeParse({ ...base, quantidade: -2 }).success).toBe(false);
    expect(movimentoInsumoSchema.safeParse({ ...base, motivo: '' }).success).toBe(false);
    expect(
      movimentoInsumoSchema.safeParse({ ...base, tipo: 'AJUSTE', quantidade: -2 }).success,
    ).toBe(true);
  });
});
