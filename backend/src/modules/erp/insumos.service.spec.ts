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
  cores: [] as unknown[],
  ...over,
});

const corDoInsumo = (id: string, nome: string, custo: number, ativo = true) => ({
  id,
  corId: `cor-${nome.toLowerCase()}`,
  custoMedio: new Prisma.Decimal(custo),
  ativo,
  cor: { nome, hex: '#000000', ordem: 0 },
});

function montar(
  opts: {
    ligado?: boolean;
    saldo?: number;
    movs?: number;
    emFicha?: number;
    /** Cores do insumo (InsumoCor). */
    cores?: Array<ReturnType<typeof corDoInsumo>>;
    /** Saldos por cor (groupBy). */
    saldosCor?: Array<{ insumoCorId: string | null; saldo: number }>;
  } = {},
) {
  const cores = opts.cores ?? [];
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ custoMedio: new Prisma.Decimal(40) }]),
    insumoMovimento: {
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { quantidade: new Prisma.Decimal(opts.saldo ?? 0) } }),
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(opts.movs ?? 0),
    },
    insumo: {
      create: vi.fn().mockResolvedValue({ id: 'ins-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    insumoCor: {
      findMany: vi.fn().mockResolvedValue(cores),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          cores.find((c) => c.id === where.id) ?? null,
      ),
      update: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(cores.length),
    },
    ordemProducaoConsumo: { count: vi.fn().mockResolvedValue(0) },
    fichaTecnicaItem: { count: vi.fn().mockResolvedValue(0) },
  };
  const prisma = {
    insumo: {
      findFirst: vi.fn().mockResolvedValue(insumo({ cores })),
      findMany: vi.fn().mockResolvedValue([insumo({ cores })]),
      create: vi.fn().mockResolvedValue(insumo()),
      update: vi.fn().mockResolvedValue(insumo()),
      delete: vi.fn().mockResolvedValue({}),
    },
    insumoCor: { findMany: vi.fn().mockResolvedValue(cores) },
    catalogoCor: {
      count: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length),
    },
    insumoMovimento: {
      groupBy: vi.fn().mockResolvedValue(
        opts.saldosCor
          ? opts.saldosCor.map((x) => ({
              insumoId: 'ins-1',
              insumoCorId: x.insumoCorId,
              _sum: { quantidade: new Prisma.Decimal(x.saldo) },
            }))
          : [
              {
                insumoId: 'ins-1',
                insumoCorId: null,
                _sum: { quantidade: new Prisma.Decimal(opts.saldo ?? 0) },
              },
            ],
      ),
      count: vi.fn().mockResolvedValue(opts.movs ?? 0),
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    fichaTecnicaItem: { count: vi.fn().mockResolvedValue(opts.emFicha ?? 0) },
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
    expect(tx.insumoMovimento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipo: 'ENTRADA_COMPRA', documento: 'NF 123' }),
      }),
    );
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
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('excluir insumo com histórico: recusa (desative)', async () => {
    const { svc, prisma } = montar({ movs: 1 });
    await expect(svc.excluir(user as never, 'ins-1')).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.insumo.delete).not.toHaveBeenCalled();
  });

  it('excluir insumo que está em ficha técnica: recusa (FK daria erro de banco)', async () => {
    const { svc, prisma } = montar({ emFicha: 2 });
    await expect(svc.excluir(user as never, 'ins-1')).rejects.toThrow(/ficha/);
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

describe('InsumosService — insumo com cores (Léo, 07/10)', () => {
  const preto = corDoInsumo('ic-preto', 'Preto', 30);
  const bege = corDoInsumo('ic-bege', 'Bege', 0);

  it('lista: saldo, custo e valor POR COR; o mínimo vale pra cada cor', async () => {
    const { svc } = montar({
      cores: [preto, bege],
      saldosCor: [
        { insumoCorId: 'ic-preto', saldo: 20 },
        { insumoCorId: 'ic-bege', saldo: 4 },
      ],
    });
    const [i] = await svc.listar(user as never);
    expect(i.temCores).toBe(true);
    expect(i.cores.map((c) => [c.nome, c.saldo, c.valorEmEstoque, c.repor])).toEqual([
      ['Bege', 4, 0, true],
      ['Preto', 20, 600, false],
    ]);
    expect(i).toMatchObject({ saldo: 24, valorEmEstoque: 600, repor: true });
  });

  it('cor desligada some da lista — a não ser que ainda tenha saldo', async () => {
    const desligada = corDoInsumo('ic-cinza', 'Cinza', 10, false);
    const { svc } = montar({
      cores: [preto, desligada],
      saldosCor: [{ insumoCorId: 'ic-cinza', saldo: 0 }],
    });
    expect((await svc.listar(user as never))[0].cores.map((c) => c.nome)).toEqual(['Preto']);
    const com = montar({
      cores: [preto, desligada],
      saldosCor: [{ insumoCorId: 'ic-cinza', saldo: 3 }],
    });
    expect((await com.svc.listar(user as never))[0].cores.map((c) => c.nome)).toEqual([
      'Cinza',
      'Preto',
    ]);
  });

  it('compra DA COR: trava o insumo, média da cor, e o insumo fica com a média das cores', async () => {
    const { svc, tx } = montar({ cores: [preto, bege], saldo: 10 });
    await svc.comprar(user as never, 'ins-1', {
      insumoCorId: 'ic-preto',
      quantidade: 10,
      custoUnitario: 50,
      documento: null,
      motivo: null,
    });
    expect(String(tx.$queryRaw.mock.calls[0][0].join('?'))).toContain('"Insumo"');
    expect(tx.insumoMovimento.aggregate).toHaveBeenCalledWith({
      where: { insumoId: 'ins-1', insumoCorId: 'ic-preto' },
      _sum: { quantidade: true },
    });
    expect(tx.insumoMovimento.create.mock.calls[0][0].data.insumoCorId).toBe('ic-preto');
    // 10 kg a R$ 30 + 10 kg a R$ 50 = R$ 40 NA COR
    expect(tx.insumoCor.update).toHaveBeenCalledWith({
      where: { id: 'ic-preto' },
      data: { custoMedio: expect.anything() },
    });
    expect(Number(tx.insumoCor.update.mock.calls[0][0].data.custoMedio)).toBe(40);
    // o custo do insumo NÃO vira o da compra: é recalculado pela média das cores
    expect(tx.insumo.update).toHaveBeenCalledTimes(1);
  });

  it('insumo com cores: movimento SEM cor, ou cor de outro insumo, é recusado', async () => {
    const { svc, prisma } = montar({ cores: [preto] });
    const mov = { tipo: 'PERDA' as const, quantidade: 1, motivo: 'rasgou', documento: null };
    await expect(svc.movimentar(user as never, 'ins-1', mov)).rejects.toThrow(/Escolha a cor/);
    await expect(
      svc.movimentar(user as never, 'ins-1', { ...mov, insumoCorId: 'ic-de-outro' }),
    ).rejects.toThrow(/não é deste insumo/);
    expect(prisma.insumoMovimento.create).not.toHaveBeenCalled();
  });

  it('insumo SEM cores não aceita cor no movimento', async () => {
    const { svc } = montar();
    await expect(
      svc.movimentar(user as never, 'ins-1', {
        tipo: 'PERDA',
        quantidade: 1,
        motivo: 'x',
        documento: null,
        insumoCorId: 'ic-preto',
      }),
    ).rejects.toThrow(/não tem cores/);
  });

  it('trocar as cores: entra a nova, sai a sem histórico, desliga a com histórico', async () => {
    const cinza = corDoInsumo('ic-cinza', 'Cinza', 0);
    const { svc, tx } = montar({ cores: [preto, cinza] });
    // Preto tem histórico; Cinza não.
    tx.insumoMovimento.count.mockImplementation(
      async ({ where }: { where: { insumoCorId?: string } }) =>
        where.insumoCorId === 'ic-preto' ? 3 : 0,
    );
    await svc.atualizar(user as never, 'ins-1', {
      nome: 'Moletinho',
      tipo: 'TECIDO',
      unidade: 'KG',
      cor: null,
      fornecedor: null,
      cores: ['cor-bege'],
    });
    expect(tx.insumoCor.createMany).toHaveBeenCalledWith({
      data: [{ empresaId: 'emp-1', insumoId: 'ins-1', corId: 'cor-bege' }],
    });
    expect(tx.insumoCor.delete).toHaveBeenCalledWith({ where: { id: 'ic-cinza' } });
    expect(tx.insumoCor.update).toHaveBeenCalledWith({
      where: { id: 'ic-preto' },
      data: { ativo: false },
    });
  });

  it('insumo que já movimentou SEM cor não ganha cores (o saldo não teria pra onde ir)', async () => {
    const { svc, tx } = montar({ movs: 2 });
    await expect(
      svc.atualizar(user as never, 'ins-1', {
        nome: 'Moletinho',
        tipo: 'TECIDO',
        unidade: 'KG',
        cor: null,
        fornecedor: null,
        cores: ['cor-preto'],
      }),
    ).rejects.toThrow(/sem cor/);
    expect(tx.insumoCor.createMany).not.toHaveBeenCalled();
  });

  it('cor que não é da lista da empresa: recusa', async () => {
    const { svc, prisma } = montar();
    prisma.catalogoCor.count.mockResolvedValue(0);
    await expect(
      svc.criar(user as never, {
        nome: 'Ribana',
        tipo: 'TECIDO',
        unidade: 'KG',
        cor: null,
        fornecedor: null,
        cores: ['cor-de-outra-empresa'],
      }),
    ).rejects.toThrow(/lista de cores/);
  });
});

describe('InsumosService → financeiro (Fase 3)', () => {
  it('compra vira conta a pagar com o vencimento e o total informados, dentro da tx', async () => {
    const { prisma, tx } = montar({ saldo: 0 });
    tx.insumoMovimento.create.mockResolvedValue({ id: 'mov-9' });
    const fin = { preparar: vi.fn().mockResolvedValue(true), compraInsumoNaTx: vi.fn() };
    const erp = { empresaLigada: vi.fn().mockResolvedValue('emp-1') };
    const svc = new InsumosService(prisma as never, erp as never, fin as never);
    await svc.comprar(user as never, 'ins-1', {
      quantidade: 50,
      custoUnitario: 12.3333,
      documento: 'NF 991',
      motivo: null,
      vencimento: '2026-11-05',
      valorTotal: 616.67,
    });
    expect(fin.compraInsumoNaTx).toHaveBeenCalledWith(tx, 'mov-9', {
      vencimento: '2026-11-05',
      valorTotal: 616.67,
    });
  });
});
