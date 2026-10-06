import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { FinanceiroController } from './financeiro.controller';
import {
  dataPura,
  hojePuro,
  situacao,
  somarMeses,
  statusPelasBaixas,
  vencimentoNoMes,
} from './financeiro.regras';
import { FinanceiroService } from './financeiro.service';

const user = { id: 'u-1', role: 'DIRECTOR', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] };
const Dc = (v: number) => new Prisma.Decimal(v);
const iso = (d: Date) => d.toISOString().slice(0, 10);

function montar(
  opts: { ligado?: boolean; categorias?: number; baixas?: number[]; status?: string } = {},
) {
  const tituloTx = {
    valor: Dc(100),
    status: opts.status ?? 'ABERTO',
    baixas: (opts.baixas ?? []).map((v) => ({ valor: Dc(v) })),
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    finTitulo: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(tituloTx),
      update: vi.fn().mockResolvedValue({}),
    },
    finBaixa: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    empresa: {
      findUnique: vi.fn().mockResolvedValue({
        config: opts.ligado === false ? {} : { financeiro: { ativo: true } },
      }),
    },
    finCategoria: {
      count: vi.fn().mockResolvedValue(opts.categorias ?? 5),
      createMany: vi.fn().mockResolvedValue({ count: 14 }),
      findFirst: vi.fn().mockResolvedValue({ id: 'cat-1' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    finConta: {
      count: vi.fn().mockResolvedValue(2),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      findFirst: vi.fn().mockResolvedValue({ id: 'conta-1' }),
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: 'banco', nome: 'Banco', tipo: 'BANCO', ativo: true, saldoInicial: Dc(1000) },
        ]),
    },
    finTitulo: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 't-1', tipo: 'PAGAR', valor: Dc(100), status: 'ABERTO' }),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    finBaixa: {
      count: vi.fn().mockResolvedValue(opts.baixas?.length ?? 0),
      findFirst: vi.fn().mockResolvedValue({ id: 'b-1', tituloId: 't-1' }),
      groupBy: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _sum: { valor: null } }),
    },
    finRecorrencia: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { svc: new FinanceiroService(prisma as never), prisma, tx };
}

describe('regras do financeiro', () => {
  it('status pelas baixas (em centavos)', () => {
    expect(statusPelasBaixas(10000, 0)).toBe('ABERTO');
    expect(statusPelasBaixas(10000, 4000)).toBe('PARCIAL');
    expect(statusPelasBaixas(10000, 10000)).toBe('QUITADO');
  });
  it('vencido = aberto/parcial com vencimento antes de hoje (não é gravado)', () => {
    const hoje = dataPura('2026-10-07');
    expect(situacao('ABERTO', dataPura('2026-10-06'), hoje)).toBe('VENCIDO');
    expect(situacao('PARCIAL', dataPura('2026-10-01'), hoje)).toBe('VENCIDO');
    expect(situacao('ABERTO', dataPura('2026-10-07'), hoje)).toBe('ABERTO');
    expect(situacao('QUITADO', dataPura('2026-01-01'), hoje)).toBe('QUITADO');
  });
  it('dia 31 em fevereiro vira o último dia; parcelas mensais mantêm o dia', () => {
    expect(iso(vencimentoNoMes(2027, 1, 31))).toBe('2027-02-28');
    const jan31 = dataPura('2027-01-31');
    expect([0, 1, 2].map((m) => iso(somarMeses(jan31, m)))).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
    expect(iso(somarMeses(dataPura('2026-12-10'), 1))).toBe('2027-01-10');
  });
  it('"hoje" é o dia de Brasília (23h de SP ainda é o mesmo dia)', () => {
    expect(iso(hojePuro(new Date('2026-10-08T02:30:00Z')))).toBe('2026-10-07');
  });
});

describe('FinanceiroService', () => {
  it('só ADMIN e DIRECTOR passam pelo controller', () => {
    const roles = new Reflector().get<string[]>('roles', FinanceiroController);
    expect([...roles].sort()).toEqual(['ADMIN', 'DIRECTOR']);
  });

  it('empresa SEM a flag: status falso e 422 sem ler nem gravar', async () => {
    const { svc, prisma } = montar({ ligado: false });
    expect(await svc.status(user as never)).toEqual({ ativo: false });
    await expect(
      svc.listar(user as never, { tipo: 'PAGAR', situacao: 'ABERTO' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.finTitulo.findMany).not.toHaveBeenCalled();
    expect(prisma.finCategoria.createMany).not.toHaveBeenCalled();
  });

  it('primeira vez: cria a lista padrão de confecção e as contas Banco e Asaas', async () => {
    const { svc, prisma } = montar({ categorias: 0 });
    prisma.finConta.count.mockResolvedValue(0);
    await svc.categorias(user as never);
    const nomes = prisma.finCategoria.createMany.mock.calls[0][0].data.map(
      (c: { nome: string }) => c.nome,
    );
    expect(nomes).toEqual(
      expect.arrayContaining(['Facção', 'Tecido', 'Aviamento', 'Venda atacado']),
    );
    expect(
      prisma.finConta.createMany.mock.calls[0][0].data.map((c: { nome: string }) => c.nome),
    ).toEqual(['Banco', 'Asaas']);
  });

  it('lançamento parcelado em 3: um título por mês, valor por parcela', async () => {
    const { svc, prisma } = montar();
    await svc.criar(
      user as never,
      {
        tipo: 'PAGAR',
        descricao: 'Máquina de costura',
        valor: 500,
        vencimento: '2026-10-10',
        parcelas: 3,
      } as never,
    );
    const d = prisma.finTitulo.createMany.mock.calls[0][0].data;
    expect(d.map((t: { descricao: string }) => t.descricao)).toEqual([
      'Máquina de costura (1/3)',
      'Máquina de costura (2/3)',
      'Máquina de costura (3/3)',
    ]);
    expect(d.map((t: { vencimento: Date }) => iso(t.vencimento))).toEqual([
      '2026-10-10',
      '2026-11-10',
      '2026-12-10',
    ]);
    expect(Number(d[0].valor)).toBe(500);
  });

  it('baixa parcial: trava a linha, grava e o status vira PARCIAL', async () => {
    const { svc, tx } = montar({ baixas: [] });
    tx.finTitulo.findUniqueOrThrow
      .mockResolvedValueOnce({ valor: Dc(100), status: 'ABERTO', baixas: [] })
      .mockResolvedValueOnce({ valor: Dc(100), status: 'ABERTO', baixas: [{ valor: Dc(40) }] });
    await svc.baixar(user as never, 't-1', {
      valor: 40,
      data: '2026-10-07',
      contaId: 'banco',
      observacao: null,
    });
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    expect(tx.finTitulo.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { status: 'PARCIAL' },
    });
  });

  it('baixa que passa do que falta: recusa', async () => {
    const { svc, tx } = montar({ baixas: [70] });
    await expect(
      svc.baixar(user as never, 't-1', {
        valor: 40,
        data: '2026-10-07',
        contaId: 'banco',
        observacao: null,
      }),
    ).rejects.toThrow(/passa do que falta \(falta 30,00\)/);
    expect(tx.finBaixa.create).not.toHaveBeenCalled();
  });

  it('título já quitado não recebe baixa', async () => {
    const { svc } = montar({ baixas: [100] });
    await expect(
      svc.baixar(user as never, 't-1', {
        valor: 1,
        data: '2026-10-07',
        contaId: 'banco',
        observacao: null,
      }),
    ).rejects.toThrow(/já está quitado/);
  });

  it('estornar baixa recalcula o status (volta a ABERTO)', async () => {
    const { svc, tx } = montar();
    tx.finTitulo.findUniqueOrThrow.mockResolvedValue({
      valor: Dc(100),
      status: 'QUITADO',
      baixas: [],
    });
    await svc.estornarBaixa(user as never, 'b-1');
    expect(tx.finBaixa.update).toHaveBeenCalledWith({
      where: { id: 'b-1' },
      data: { estornadaEm: expect.any(Date) },
    });
    expect(tx.finTitulo.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { status: 'ABERTO' },
    });
  });

  it('cancelar título com baixa: recusa (estorne antes)', async () => {
    const { svc, prisma } = montar({ baixas: [10] });
    await expect(svc.cancelar(user as never, 't-1')).rejects.toThrow(/estorne/);
    expect(prisma.finTitulo.update).not.toHaveBeenCalled();
  });

  it('saldo da conta = inicial + recebido − pago', async () => {
    const { svc, prisma } = montar();
    prisma.finBaixa.groupBy
      .mockResolvedValueOnce([{ contaId: 'banco', _sum: { valor: Dc(2500.5) } }])
      .mockResolvedValueOnce([{ contaId: 'banco', _sum: { valor: Dc(800.25) } }]);
    const [c] = await svc.contas(user as never);
    expect(c.saldo).toBe(2700.25);
  });

  it('recorrente: gera este mês e o próximo, sem duplicar (único por vencimento)', async () => {
    const { svc, prisma } = montar();
    prisma.finRecorrencia.findMany.mockResolvedValue([
      {
        id: 'r1',
        empresaId: 'emp-1',
        tipo: 'PAGAR',
        descricao: 'Aluguel',
        valor: Dc(3000),
        dia: 31,
        categoriaId: null,
        contatoNome: null,
      },
    ]);
    await svc.gerarRecorrentes(new Date('2027-01-15T12:00:00Z'));
    const vencs = prisma.finTitulo.createMany.mock.calls.map((c) => iso(c[0].data[0].vencimento));
    expect(vencs).toEqual(['2027-01-31', '2027-02-28']);
    expect(prisma.finTitulo.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });
});
