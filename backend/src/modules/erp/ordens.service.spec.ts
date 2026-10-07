import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { OrdensController } from './ordens.controller';
import { OrdensService, necessidadesDaGrade, ratearCusto } from './ordens.service';

const user = { id: 'u-1', role: 'DIRECTOR', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] };
const Dc = (v: number) => new Prisma.Decimal(v);

const variacao = (produtoId: string, modeloLinhaId: string) => ({
  produtoId,
  modeloLinhaId,
  ativo: true,
  modeloCor: { ordem: 0, cor: { nome: 'Preto', hex: '#000000' } },
  modeloLinha: { linha: { nome: modeloLinhaId === 'ml-reg' ? 'Regular' : 'Plus', ordem: 0 } },
  modeloTamanho: { tamanho: { nome: produtoId, ordem: 0 } },
});

function montar(opts: { status?: string; ligado?: boolean } = {}) {
  const tx = {
    ordemProducao: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    ordemProducaoItem: {
      updateMany: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn().mockResolvedValue([
        { produtoId: 'p-m', enviada: 10 },
        { produtoId: 'p-g1', enviada: 5 },
      ]),
    },
    ordemProducaoEntrega: {
      create: vi.fn().mockResolvedValue({}),
      groupBy: vi
        .fn()
        .mockResolvedValue([{ produtoId: 'p-m', _sum: { quantidade: 4, defeito: 1 } }]),
    },
    ordemProducaoConsumo: { create: vi.fn().mockResolvedValue({}) },
    ordemProducaoCusto: { createMany: vi.fn().mockResolvedValue({}) },
    insumo: {
      findMany: vi.fn().mockResolvedValue([{ id: 'tec', tipo: 'TECIDO', custoMedio: Dc(42) }]),
    },
    insumoMovimento: { create: vi.fn().mockResolvedValue({}) },
    estoqueMovimento: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    catalogoModelo: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', nome: 'Short 100' }) },
    catalogoVariacao: {
      findMany: vi.fn().mockResolvedValue([variacao('p-m', 'ml-reg'), variacao('p-g1', 'ml-plus')]),
    },
    fichaTecnica: {
      findMany: vi.fn().mockResolvedValue([
        {
          modeloLinhaId: 'ml-reg',
          custoFaccaoPrevisto: Dc(4),
          itens: [
            {
              insumoId: 'tec',
              consumoPorPeca: Dc(0.3),
              insumo: {
                nome: 'Tactel',
                cor: null,
                tipo: 'TECIDO',
                unidade: 'KG',
                custoMedio: Dc(42),
              },
            },
          ],
        },
      ]),
    },
    insumoMovimento: {
      groupBy: vi.fn().mockResolvedValue([{ insumoId: 'tec', _sum: { quantidade: Dc(2) } }]),
    },
    faccaoPreco: { findUnique: vi.fn().mockResolvedValue({ precoPorPeca: Dc(5) }) },
    faccao: { findFirst: vi.fn().mockResolvedValue({ id: 'f-1', nome: 'Dona Rosa' }) },
    ordemProducao: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'op-1',
        numero: 'OP-0001',
        status: opts.status ?? 'RASCUNHO',
        modeloId: 'm-1',
        faccaoId: null,
      }),
      create: vi.fn().mockResolvedValue({ id: 'op-1', numero: 'OP-0001' }),
    },
    ordemProducaoItem: {
      findMany: vi.fn().mockResolvedValue([
        { produtoId: 'p-m', cortada: 10 },
        { produtoId: 'p-g1', cortada: 5 },
      ]),
    },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const erp = {
    empresaLigada: vi.fn(async () => {
      if (opts.ligado === false) throw new BusinessRuleException('desligado');
      return 'emp-1';
    }),
  };
  const fichas = { custosPrevistos: vi.fn().mockResolvedValue(new Map()) };
  const seq = { next: vi.fn().mockResolvedValue(7) };
  const svc = new OrdensService(prisma as never, erp as never, fichas as never, seq as never);
  // obter() é leitura pesada; nas etapas só importa o que gravou.
  vi.spyOn(svc, 'obter').mockResolvedValue({} as never);
  return { svc, prisma, tx, fichas };
}

describe('contas da OP', () => {
  it('necessidade = peças da grade × consumo da ficha daquela grade', () => {
    const m = necessidadesDaGrade(
      new Map([
        ['reg', 100],
        ['plus', 20],
      ]),
      new Map([
        ['reg', [{ insumoId: 'tec', consumoPorPeca: 0.3 }]],
        [
          'plus',
          [
            { insumoId: 'tec', consumoPorPeca: 0.4 },
            { insumoId: 'elast', consumoPorPeca: 1.1 },
          ],
        ],
      ]),
    );
    expect(m.get('tec')).toBeCloseTo(38, 6);
    expect(m.get('elast')).toBeCloseTo(22, 6);
  });

  it('rateio pelo previsto da ficha; custo por peça sobre as RECEBIDAS', () => {
    const r = ratearCusto(1200, [
      { modeloLinhaId: 'reg', cortadas: 100, recebidas: 98, previstoPorPeca: 10 },
      { modeloLinhaId: 'plus', cortadas: 20, recebidas: 20, previstoPorPeca: 20 },
    ]);
    // pesos 1000 e 400 → 857,14 e 342,86
    expect(r[0].custoTotal).toBeCloseTo(857.142857, 4);
    expect(r[0].custoPorPeca).toBeCloseTo(857.142857 / 98, 4);
    expect(r[1].custoPorPeca).toBeCloseTo(342.857143 / 20, 4);
  });

  it('grade com e sem ficha misturadas: rateia por peças', () => {
    const r = ratearCusto(120, [
      { modeloLinhaId: 'a', cortadas: 10, recebidas: 10, previstoPorPeca: 50 },
      { modeloLinhaId: 'b', cortadas: 2, recebidas: 2, previstoPorPeca: null },
    ]);
    expect(r.map((x) => x.custoTotal)).toEqual([100, 20]);
  });
});

describe('OrdensService', () => {
  it('só ADMIN e DIRECTOR passam pelo controller', () => {
    const roles = new Reflector().get<string[]>('roles', OrdensController);
    expect([...roles].sort()).toEqual(['ADMIN', 'DIRECTOR']);
  });

  it('ERP desligado: recusa sem ler nada', async () => {
    const { svc, prisma } = montar({ ligado: false });
    await expect(svc.listar(user as never)).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.catalogoModelo.findFirst).not.toHaveBeenCalled();
  });

  it('simulação: tecido pela ficha, o que falta no estoque e custo com a facção da tabela', async () => {
    const { svc } = montar();
    const s = await svc.simular(user as never, {
      modeloId: 'm-1',
      faccaoId: 'f-1',
      itens: [{ produtoId: 'p-m', quantidade: 10 }],
    });
    expect(s.insumos[0]).toMatchObject({ insumoId: 'tec', necessario: 3, saldo: 2, falta: 1 });
    expect(s.custoInsumos).toBeCloseTo(126, 6); // 3 kg × 42
    expect(s.custoFaccao).toBe(50); // 10 × R$ 5 (tabela da facção)
    expect(s.custoPorPeca).toBeCloseTo(17.6, 6);
  });

  it('grade com variação de OUTRO modelo: recusa', async () => {
    const { svc } = montar();
    await expect(
      svc.simular(user as never, {
        modeloId: 'm-1',
        itens: [{ produtoId: 'alheio', quantidade: 1 }],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('corte: tecido sai do estoque com o nº da OP e o custo médio da hora', async () => {
    const { svc, tx } = montar();
    await svc.cortar(user as never, 'op-1', {
      tecidos: [{ insumoId: 'tec', quantidade: 3.2 }],
      itens: [{ produtoId: 'p-m', cortada: 10 }],
    });
    expect(tx.insumoMovimento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tipo: 'CONSUMO_CORTE', documento: 'OP-0001' }),
    });
    expect(Number(tx.insumoMovimento.create.mock.calls[0][0].data.quantidade)).toBe(-3.2);
    const virada = tx.ordemProducao.updateMany.mock.calls[0][0];
    expect(virada.where.status).toEqual({ in: ['RASCUNHO'] });
    expect(Number(virada.data.custoTecido)).toBeCloseTo(134.4, 2);
  });

  it('corte concorrente (outra aba já cortou): CAS recusa', async () => {
    const { svc, tx } = montar();
    tx.ordemProducao.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      svc.cortar(user as never, 'op-1', {
        tecidos: [{ insumoId: 'tec', quantidade: 3 }],
        itens: [{ produtoId: 'p-m', cortada: 10 }],
      }),
    ).rejects.toThrow(/mudou de etapa/);
  });

  it('envio: facção cobra por peça ENVIADA, preço da tabela quando não informado', async () => {
    const { svc, tx } = montar({ status: 'CORTADA' });
    await svc.enviar(user as never, 'op-1', {
      faccaoId: 'f-1',
      itens: [
        { produtoId: 'p-m', enviada: 10 },
        { produtoId: 'p-g1', enviada: 4 },
      ],
      aviamentos: [],
    });
    const virada = tx.ordemProducao.updateMany.mock.calls[0][0];
    expect(Number(virada.data.custoFaccao)).toBe(70); // 14 × R$ 5
    expect(Number(virada.data.precoFaccaoPorPeca)).toBe(5);
  });

  it('envio de mais peças do que foram cortadas: recusa', async () => {
    const { svc } = montar({ status: 'CORTADA' });
    await expect(
      svc.enviar(user as never, 'op-1', {
        faccaoId: 'f-1',
        itens: [{ produtoId: 'p-m', enviada: 11 }],
        aviamentos: [],
      }),
    ).rejects.toThrow(/mais peças do que foram cortadas/);
  });

  it('facção sem preço pro modelo e sem preço informado: recusa (não inventa custo)', async () => {
    const { svc, prisma } = montar({ status: 'CORTADA' });
    prisma.faccaoPreco.findUnique.mockResolvedValue(null);
    await expect(
      svc.enviar(user as never, 'op-1', {
        faccaoId: 'f-1',
        itens: [{ produtoId: 'p-m', enviada: 1 }],
        aviamentos: [],
      }),
    ).rejects.toThrow(/não tem preço/);
  });

  it('recebimento: peça boa entra no estoque (ENTRADA_PRODUCAO); defeito não', async () => {
    const { svc, tx } = montar({ status: 'NA_FACCAO' });
    await svc.receber(user as never, 'op-1', {
      itens: [{ produtoId: 'p-m', quantidade: 4, defeito: 1 }],
    });
    expect(tx.estoqueMovimento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tipo: 'ENTRADA_PRODUCAO',
        quantidade: 4,
        documento: 'OP-0001',
      }),
    });
    expect(tx.ordemProducaoEntrega.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantidade: 4, defeito: 1 }) }),
    );
  });

  it('recebimento além do enviado (já vieram 5 de 10): recusa', async () => {
    const { svc, tx } = montar({ status: 'RECEBENDO' });
    await expect(
      svc.receber(user as never, 'op-1', {
        itens: [{ produtoId: 'p-m', quantidade: 6, defeito: 0 }],
      }),
    ).rejects.toThrow(/faltavam 5/);
    expect(tx.estoqueMovimento.create).not.toHaveBeenCalled();
  });

  it('fechar: grava o custo real por grade (vai pra calculadora)', async () => {
    const { svc, prisma, tx, fichas } = montar();
    prisma.ordemProducao.findFirst.mockResolvedValue({
      id: 'op-1',
      numero: 'OP-0001',
      status: 'RECEBENDO',
      custoTecido: Dc(126),
      custoAviamentos: Dc(4),
      custoFaccao: Dc(70),
      itens: [
        { produtoId: 'p-m', modeloLinhaId: 'ml-reg', cortada: 10 },
        { produtoId: 'p-g1', modeloLinhaId: 'ml-plus', cortada: 4 },
      ],
      entregas: [
        { produtoId: 'p-m', quantidade: 10, defeito: 0 },
        { produtoId: 'p-g1', quantidade: 4, defeito: 0 },
      ],
    });
    fichas.custosPrevistos.mockResolvedValue(new Map());
    await svc.fechar(user as never, 'op-1');
    const custos = tx.ordemProducaoCusto.createMany.mock.calls[0][0].data;
    // 200 por peças (sem ficha): 10/14 e 4/14 → R$ 14,29 por peça nas duas
    expect(custos.map((c: { pecas: number }) => c.pecas)).toEqual([10, 4]);
    expect(Number(custos[0].custoPorPeca)).toBeCloseTo(200 / 14, 3);
  });

  it('fechar OP que nem recebeu: recusa', async () => {
    const { svc, prisma } = montar();
    prisma.ordemProducao.findFirst.mockResolvedValue({
      id: 'op-1',
      status: 'NA_FACCAO',
      itens: [],
      entregas: [],
    });
    await expect(svc.fechar(user as never, 'op-1')).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('cancelar só antes de ir pra facção', async () => {
    const { svc, tx } = montar();
    await svc.cancelar(user as never, 'op-1');
    expect(tx.ordemProducao.updateMany.mock.calls[0][0].where.status).toEqual({
      in: ['RASCUNHO', 'CORTADA'],
    });
  });
});

describe('OrdensService → financeiro (Fase 3)', () => {
  it('recebimento passa as linhas desta entrega pro pagamento da facção, dentro da tx', async () => {
    const { prisma, tx } = montar({ status: 'NA_FACCAO' });
    tx.ordemProducaoEntrega.create.mockResolvedValue({ id: 'ent-1' });
    const fin = { preparar: vi.fn().mockResolvedValue(true), entregaFaccaoNaTx: vi.fn() };
    const erp = { empresaLigada: vi.fn().mockResolvedValue('emp-1') };
    const svc = new OrdensService(
      prisma as never,
      erp as never,
      {} as never,
      {} as never,
      fin as never,
    );
    vi.spyOn(svc, 'obter').mockResolvedValue({} as never);
    await svc.receber(user as never, 'op-1', {
      itens: [{ produtoId: 'p-m', quantidade: 4, defeito: 1 }],
    });
    expect(fin.entregaFaccaoNaTx).toHaveBeenCalledWith(tx, 'op-1', ['ent-1']);
  });
});
