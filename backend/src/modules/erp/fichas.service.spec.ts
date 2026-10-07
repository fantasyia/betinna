import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { FichasController } from './fichas.controller';
import { fichaSchema, regrasEncaixeSchema } from './fichas.dto';
import { FichasService, custoPrevistoDaFicha } from './fichas.service';

const user = { id: 'u-1', role: 'DIRECTOR', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] };
const Dc = (n: number) => new Prisma.Decimal(n);

function montar(opts: { ligado?: boolean } = {}) {
  const tx = {
    fichaTecnica: { upsert: vi.fn().mockResolvedValue({ id: 'f-1' }) },
    fichaTecnicaItem: {
      deleteMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    catalogoModeloLinha: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ml-1',
        modelo: { id: 'm-1', nome: 'Bermuda' },
        linha: { nome: 'Regular' },
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    fichaTecnica: {
      findUnique: vi.fn().mockResolvedValue({
        custoFaccaoPrevisto: Dc(4.5),
        observacoes: null,
        itens: [
          {
            insumoId: 'tec',
            consumoPorPeca: Dc(0.32),
            observacao: null,
            insumo: {
              id: 'tec',
              nome: 'Moletom',
              cor: null,
              unidade: 'KG',
              tipo: 'TECIDO',
              custoMedio: Dc(42),
              cores: [],
            },
            corFixaId: null,
            corFixa: null,
          },
          {
            insumoId: 'cord',
            consumoPorPeca: Dc(1),
            observacao: null,
            insumo: {
              id: 'cord',
              nome: 'Cordão',
              cor: null,
              unidade: 'UNIDADE',
              tipo: 'AVIAMENTO',
              custoMedio: Dc(0),
              cores: [],
            },
            corFixaId: null,
            corFixa: null,
          },
        ],
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    insumo: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'tec', nome: 'Moletom', cores: [] },
        { id: 'cord', nome: 'Cordão', cores: [] },
      ]),
    },
    catalogoModelo: {
      count: vi.fn().mockResolvedValue(1),
      findFirst: vi.fn().mockResolvedValue({ id: 'm-1', nome: 'Short', regrasEncaixe: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    faccao: {
      findFirst: vi.fn().mockResolvedValue({ id: 'fac-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'fac-1' }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    faccaoPreco: {
      deleteMany: vi.fn().mockReturnValue('del'),
      createMany: vi.fn().mockReturnValue('cre'),
    },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.resolve(arg),
    ),
  };
  const erp = {
    empresaLigada: vi.fn(async () => {
      if (opts.ligado === false) throw new BusinessRuleException('desligado');
      return 'emp-1';
    }),
  };
  return { svc: new FichasService(prisma as never, erp as never), prisma, tx };
}

describe('custo previsto pela ficha', () => {
  it('Σ consumo × custo médio + facção prevista', () => {
    expect(
      custoPrevistoDaFicha(
        [
          { consumoPorPeca: 0.32, custoMedio: 42 },
          { consumoPorPeca: 1, custoMedio: 0.35 },
        ],
        4.5,
      ),
    ).toEqual({ insumos: expect.closeTo(13.79, 6), faccao: 4.5, total: expect.closeTo(18.29, 6) });
  });
});

describe('FichasService', () => {
  it('só ADMIN e DIRECTOR passam pelo controller', () => {
    const roles = new Reflector().get<string[]>('roles', FichasController);
    expect([...roles].sort()).toEqual(['ADMIN', 'DIRECTOR']);
  });

  it('ERP desligado: recusa sem ler nada', async () => {
    const { svc, prisma } = montar({ ligado: false });
    await expect(svc.obter(user as never, 'ml-1')).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.fichaTecnica.findUnique).not.toHaveBeenCalled();
  });

  it('ficha: custo por item, total previsto e aviso de insumo sem custo', async () => {
    const { svc } = montar();
    const f = await svc.obter(user as never, 'ml-1');
    expect(f.itens[0].custoPorPeca).toBeCloseTo(13.44, 6);
    expect(f.custoPrevisto.total).toBeCloseTo(17.94, 6);
    expect(f.semCusto).toEqual(['Cordão']);
  });

  it('linha de OUTRA empresa: 404', async () => {
    const { svc, prisma } = montar();
    prisma.catalogoModeloLinha.findFirst.mockResolvedValue(null);
    await expect(
      svc.salvar(user as never, 'ml-x', { observacoes: null, itens: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('salvar SUBSTITUI os itens da ficha', async () => {
    const { svc, tx } = montar();
    await svc.salvar(user as never, 'ml-1', {
      custoFaccaoPrevisto: 4.5,
      observacoes: null,
      itens: [
        { insumoId: 'tec', consumoPorPeca: 0.32, observacao: null },
        { insumoId: 'cord', consumoPorPeca: 1, observacao: null },
      ],
    });
    expect(tx.fichaTecnicaItem.deleteMany).toHaveBeenCalledWith({ where: { fichaId: 'f-1' } });
    expect(tx.fichaTecnicaItem.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('cor fixa (cordão sempre Branco): o custo do item é o DAQUELA cor', async () => {
    const { svc, prisma } = montar();
    const ficha = await prisma.fichaTecnica.findUnique();
    ficha.itens[1].corFixaId = 'cor-branco';
    ficha.itens[1].corFixa = { id: 'cor-branco', nome: 'Branco', hex: '#fff' };
    ficha.itens[1].insumo.custoMedio = Dc(0.5); // média das cores
    ficha.itens[1].insumo.cores = [
      { corId: 'cor-branco', custoMedio: Dc(0.3), cor: { nome: 'Branco', hex: '#fff' } },
      { corId: 'cor-preto', custoMedio: Dc(0.7), cor: { nome: 'Preto', hex: '#000' } },
    ];
    prisma.fichaTecnica.findUnique.mockResolvedValue(ficha);
    const r = await svc.obter(user as never, 'ml-1');
    expect(r.itens[1].custoPorPeca).toBeCloseTo(0.3, 6);
    expect(r.itens[1].corFixa).toEqual({ id: 'cor-branco', nome: 'Branco', hex: '#fff' });
  });

  it('cor fixa que não é do insumo (ou insumo sem cores): recusa', async () => {
    const { svc, prisma, tx } = montar();
    const tec = { id: 'tec', nome: 'Moletom', cores: [] };
    const cord = { id: 'cord', nome: 'Cordão', cores: [{ corId: 'cor-branco' }] };
    prisma.insumo.findMany
      .mockResolvedValueOnce([tec])
      .mockResolvedValueOnce([cord])
      .mockResolvedValueOnce([cord]);
    const base = { insumoId: 'tec', consumoPorPeca: 0.32, observacao: null };
    await expect(
      svc.salvar(user as never, 'ml-1', {
        observacoes: null,
        itens: [{ ...base, corFixaId: 'cor-branco' }],
      }),
    ).rejects.toThrow(/não tem cores/);
    await expect(
      svc.salvar(user as never, 'ml-1', {
        observacoes: null,
        itens: [{ insumoId: 'cord', consumoPorPeca: 1, observacao: null, corFixaId: 'cor-roxo' }],
      }),
    ).rejects.toThrow(/não é uma das cores/);
    expect(tx.fichaTecnica.upsert).not.toHaveBeenCalled();
    await svc.salvar(user as never, 'ml-1', {
      observacoes: null,
      itens: [{ insumoId: 'cord', consumoPorPeca: 1, observacao: null, corFixaId: 'cor-branco' }],
    });
    expect(tx.fichaTecnicaItem.createMany.mock.calls[0][0].data[0].corFixaId).toBe('cor-branco');
  });

  it('insumo de outra empresa na ficha: recusa', async () => {
    const { svc, prisma, tx } = montar();
    prisma.insumo.findMany.mockResolvedValue([{ id: 'tec', nome: 'Moletom', cores: [] }]);
    await expect(
      svc.salvar(user as never, 'ml-1', {
        observacoes: null,
        itens: [
          { insumoId: 'tec', consumoPorPeca: 0.32, observacao: null },
          { insumoId: 'alheio', consumoPorPeca: 1, observacao: null },
        ],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    expect(tx.fichaTecnica.upsert).not.toHaveBeenCalled();
  });

  it('tabela da facção com modelo de outra empresa: recusa', async () => {
    const { svc, prisma } = montar();
    prisma.catalogoModelo.count.mockResolvedValue(0);
    await expect(
      svc.salvarPrecos(user as never, 'fac-1', {
        precos: [{ modeloId: 'alheio', precoPorPeca: 5 }],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.faccaoPreco.deleteMany).not.toHaveBeenCalled();
  });

  it('facção de OUTRA empresa: 404', async () => {
    const { svc, prisma } = montar();
    prisma.faccao.findFirst.mockResolvedValue(null);
    await expect(svc.excluirFaccao(user as never, 'fac-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.faccao.delete).not.toHaveBeenCalled();
  });

  it('DTO: insumo repetido na ficha é recusado', () => {
    const r = fichaSchema.safeParse({
      itens: [
        { insumoId: 'a', consumoPorPeca: 1 },
        { insumoId: 'a', consumoPorPeca: 2 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('regras de encaixe do produto 100 (tubular, 103 cm, espelha, corpo 180, forro livre)', async () => {
    const { svc, prisma } = montar();
    const r100 = {
      tecido: 'TUBULAR' as const,
      larguraUtilMm: 1030,
      espelhar: true,
      giroCorpo: 'GIRA_180' as const,
      giroForro: 'LIVRE' as const,
      encavalamentoMm: 0,
      espacamentoMm: 0,
      observacoes: null,
    };
    expect(regrasEncaixeSchema.safeParse(r100).success).toBe(true);
    await svc.salvarRegrasEncaixe(user as never, 'm-1', r100);
    expect(prisma.catalogoModelo.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { regrasEncaixe: r100 },
    });
  });

  it('regras de encaixe: modelo de OUTRA empresa é 404; giro 90° não existe', async () => {
    const { svc, prisma } = montar();
    prisma.catalogoModelo.findFirst.mockResolvedValue(null);
    await expect(svc.regrasEncaixe(user as never, 'm-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(
      regrasEncaixeSchema.safeParse({
        tecido: 'TUBULAR',
        larguraUtilMm: 1030,
        espelhar: true,
        giroCorpo: 'GIRA_90',
        giroForro: 'LIVRE',
        encavalamentoMm: 0,
        espacamentoMm: 0,
      }).success,
    ).toBe(false);
  });
});
