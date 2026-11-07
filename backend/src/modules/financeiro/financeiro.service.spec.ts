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

  describe('excluir (30/10)', () => {
    const agora = new Date('2026-10-31T12:00:00Z');
    const titulo = (o: object) => ({
      id: 't-1',
      tipo: 'PAGAR',
      valor: Dc(800),
      status: 'CANCELADO',
      vencimento: dataPura('2026-10-30'),
      recorrenciaId: null,
      ...o,
    });
    const rec = (inicio: string | null) => ({
      id: 'r1',
      dia: 30,
      ativo: true,
      inicio: inicio && dataPura(inicio),
    });

    function comExcluir(t: object, r: object | null = null, baixas = 0) {
      const m = montar();
      m.prisma.finTitulo.findFirst.mockResolvedValue(t);
      Object.assign(m.prisma.finTitulo, { delete: vi.fn().mockResolvedValue({}) });
      Object.assign(m.prisma.finRecorrencia, { findFirst: vi.fn().mockResolvedValue(r) });
      m.prisma.finBaixa.count.mockResolvedValue(baixas);
      return m as typeof m & { prisma: { finTitulo: { delete: ReturnType<typeof vi.fn> } } };
    }

    it('cancelado e sem baixa: apaga', async () => {
      const { svc, prisma } = comExcluir(titulo({}));
      expect(await svc.excluir(user as never, 't-1', agora)).toEqual({ ok: true });
      expect(prisma.finTitulo.delete).toHaveBeenCalledWith({ where: { id: 't-1' } });
    });

    it('aberto: recusa (cancele antes)', async () => {
      const { svc, prisma } = comExcluir(titulo({ status: 'ABERTO' }));
      await expect(svc.excluir(user as never, 't-1', agora)).rejects.toThrow(/Cancele/);
      expect(prisma.finTitulo.delete).not.toHaveBeenCalled();
    });

    it('com baixa, mesmo estornada: recusa (o histórico iria junto)', async () => {
      const { svc, prisma } = comExcluir(titulo({}), null, 1);
      await expect(svc.excluir(user as never, 't-1', agora)).rejects.toThrow(/baixa/);
      expect(prisma.finBaixa.count).toHaveBeenCalledWith({ where: { tituloId: 't-1' } });
      expect(prisma.finTitulo.delete).not.toHaveBeenCalled();
    });

    // Teste com baixa só estornada (Léo, 07/11): 1ª contagem = todas, 2ª = ativas.
    function soEstornada() {
      const m = comExcluir(titulo({}));
      m.prisma.finBaixa.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      return m;
    }

    it('só baixa estornada, ADMIN com levarEstornadas: apaga', async () => {
      const { svc, prisma } = soEstornada();
      const admin = { ...user, role: 'ADMIN' };
      expect(await svc.excluir(admin as never, 't-1', agora, true)).toEqual({ ok: true });
      expect(prisma.finTitulo.delete).toHaveBeenCalledWith({ where: { id: 't-1' } });
    });

    it('só baixa estornada, sem levarEstornadas ou sem ser ADMIN: recusa', async () => {
      const a = soEstornada();
      await expect(
        a.svc.excluir({ ...user, role: 'ADMIN' } as never, 't-1', agora),
      ).rejects.toThrow(/mesmo estornada/);
      const d = soEstornada();
      await expect(d.svc.excluir(user as never, 't-1', agora, true)).rejects.toThrow(
        /mesmo estornada/,
      );
      expect(a.prisma.finTitulo.delete).not.toHaveBeenCalled();
      expect(d.prisma.finTitulo.delete).not.toHaveBeenCalled();
    });

    it('baixa ATIVA: recusa mesmo pro ADMIN com levarEstornadas', async () => {
      const { svc, prisma } = comExcluir(titulo({}), null, 1);
      await expect(
        svc.excluir({ ...user, role: 'ADMIN' } as never, 't-1', agora, true),
      ).rejects.toThrow(/baixa ativa/);
      expect(prisma.finTitulo.delete).not.toHaveBeenCalled();
    });

    it('recorrente que o job geraria de novo: recusa', async () => {
      const { svc, prisma } = comExcluir(titulo({ recorrenciaId: 'r1' }), rec(null));
      await expect(svc.excluir(user as never, 't-1', agora)).rejects.toThrow(/começa em/);
      expect(prisma.finTitulo.delete).not.toHaveBeenCalled();
    });

    it('recorrente com "começa em" depois do vencimento: apaga (não volta)', async () => {
      const { svc, prisma } = comExcluir(titulo({ recorrenciaId: 'r1' }), rec('2026-11-30'));
      expect(await svc.excluir(user as never, 't-1', agora)).toEqual({ ok: true });
      expect(prisma.finTitulo.delete).toHaveBeenCalled();
    });

    it('recorrente fora da janela do job (placeholder de 01/10): apaga', async () => {
      const t = titulo({
        recorrenciaId: 'r1',
        vencimento: dataPura('2026-10-01'),
        valor: Dc(0.01),
      });
      const { svc, prisma } = comExcluir(t, rec(null));
      expect(await svc.excluir(user as never, 't-1', agora)).toEqual({ ok: true });
      expect(prisma.finTitulo.delete).toHaveBeenCalled();
    });
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

  it('recorrente com "começa em": vencimento antes do início não é gerado (29/10)', async () => {
    const { svc, prisma } = montar();
    prisma.finRecorrencia.findMany.mockResolvedValue([
      {
        id: 'r1',
        empresaId: 'emp-1',
        tipo: 'PAGAR',
        descricao: 'Reclame Aqui',
        valor: Dc(53.9),
        dia: 12,
        categoriaId: null,
        contatoNome: null,
        inicio: dataPura('2026-11-12'),
      },
    ]);
    // Hoje 29/10: o mês atual (12/10) fica de fora; o 12/11 (= início) entra.
    await svc.gerarRecorrentes(new Date('2026-10-29T12:00:00Z'));
    const vencs = prisma.finTitulo.createMany.mock.calls.map((c) => iso(c[0].data[0].vencimento));
    expect(vencs).toEqual(['2026-11-12']);
  });
});

describe('FinanceiroService — fluxo de caixa e por contato (entrega C)', () => {
  const comContas = (prisma: ReturnType<typeof montar>['prisma']) => {
    // Banco: inicial 1.000 + recebido 500 − pago 200 = 1.300 (critério de aceite §9.5)
    prisma.finBaixa.groupBy
      .mockResolvedValueOnce([{ contaId: 'banco', _sum: { valor: Dc(500) } }])
      .mockResolvedValueOnce([{ contaId: 'banco', _sum: { valor: Dc(200) } }]);
  };

  it('saldo atual = inicial + recebido − pago; projetado soma o previsto a partir de hoje', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T15:00:00Z'));
    try {
      const { svc, prisma } = montar();
      comContas(prisma);
      prisma.finTitulo.findMany.mockResolvedValue([
        {
          tipo: 'RECEBER',
          valor: Dc(300),
          vencimento: dataPura('2026-10-09'),
          baixas: [{ valor: Dc(100) }],
        },
        { tipo: 'PAGAR', valor: Dc(50), vencimento: dataPura('2026-10-02'), baixas: [] },
      ]);
      (prisma.finBaixa as Record<string, unknown>).findMany = vi
        .fn()
        .mockResolvedValue([
          { valor: Dc(200), data: dataPura('2026-10-06'), titulo: { tipo: 'PAGAR' } },
        ]);
      const r = await svc.fluxo(user as never, {
        de: '2026-10-05',
        ate: '2026-10-11',
        agrupar: 'semana',
      });
      expect(r.saldoAtual).toBe(1300);
      expect(r.vencidos).toEqual({ aReceber: 0, aPagar: 50 });
      expect(r.linhas).toHaveLength(1);
      expect(r.linhas[0]).toMatchObject({
        atual: true,
        saiu: 200,
        aEntrar: 200,
        saldoProjetado: 1500,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('intervalo grande demais pro agrupamento: recusa (sugere agrupar maior)', async () => {
    const { svc } = montar();
    await expect(
      svc.fluxo(user as never, { de: '2026-01-01', ate: '2026-12-31', agrupar: 'dia' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('por contato: soma o que falta por nome (caixa/espaço não separam), maior primeiro', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T15:00:00Z'));
    try {
      const { svc, prisma } = montar();
      prisma.finTitulo.findMany.mockResolvedValue([
        {
          contatoNome: 'Loja da Ana',
          valor: Dc(100),
          vencimento: dataPura('2026-10-01'),
          baixas: [],
        },
        {
          contatoNome: ' loja  da ana',
          valor: Dc(300),
          vencimento: dataPura('2026-10-20'),
          baixas: [{ valor: Dc(50) }],
        },
        { contatoNome: 'Moda Sul', valor: Dc(900), vencimento: dataPura('2026-10-15'), baixas: [] },
        { contatoNome: null, valor: Dc(10), vencimento: dataPura('2026-10-15'), baixas: [] },
      ]);
      const r = await svc.porContato(user as never, { tipo: 'RECEBER' });
      expect(r.map((c) => [c.contato, c.emAberto, c.vencido])).toEqual([
        ['Moda Sul', 900, 0],
        ['Loja da Ana', 350, 100],
        [null, 10, 0],
      ]);
      expect(r[1]).toMatchObject({ titulos: 2, proximoVencimento: '2026-10-20' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('financeiro desligado: fluxo e por contato não respondem', async () => {
    const { svc } = montar({ ligado: false });
    await expect(
      svc.fluxo(user as never, { de: '2026-10-01', ate: '2026-10-31', agrupar: 'semana' }),
    ).rejects.toThrow();
    await expect(svc.porContato(user as never, { tipo: 'PAGAR' })).rejects.toThrow();
  });
});

describe('FinanceiroService — atalhos (pedido e OP)', () => {
  it('pedido: filtra pelo pedidoId', async () => {
    const { svc, prisma } = montar();
    await svc.listar(user as never, { tipo: 'RECEBER', situacao: 'TODOS', pedidoId: 'ped-1' });
    expect(prisma.finTitulo.findMany.mock.calls[0][0].where).toMatchObject({
      empresaId: 'emp-1',
      tipo: 'RECEBER',
      pedidoId: 'ped-1',
    });
  });

  it('OP: saldo (chave = OP) + entregas DESTA OP, buscadas só na empresa', async () => {
    const { svc, prisma } = montar();
    const entregas = vi.fn().mockResolvedValue([{ id: 'e-1' }, { id: 'e-2' }]);
    (prisma as Record<string, unknown>).ordemProducaoEntrega = { findMany: entregas };
    await svc.listar(user as never, { tipo: 'PAGAR', situacao: 'TODOS', opId: 'op-1' });
    expect(entregas).toHaveBeenCalledWith({
      where: { opId: 'op-1', op: { empresaId: 'emp-1' } },
      select: { id: true },
    });
    expect(prisma.finTitulo.findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ opSaldoId: 'op-1' }, { opEntregaId: { in: ['e-1', 'e-2'] } }] },
    ]);
  });
});

describe('FinanceiroService.ver (detalhe de um lançamento)', () => {
  it('traz pago/saldo sem a baixa estornada, situação e as baixas', async () => {
    const { svc, prisma } = montar();
    prisma.finTitulo.findFirst.mockResolvedValue({
      id: 't-1',
      tipo: 'RECEBER',
      descricao: 'PED-0002 · parcela 1/2',
      valor: Dc(332.33),
      vencimento: new Date('2026-11-09T00:00:00Z'),
      status: 'PARCIAL',
      categoria: { id: 'cat-1', nome: 'Vendas' },
      contatoNome: 'Cliente',
      observacoes: null,
      pedidoId: 'ped-2',
      parcela: 1,
      totalParcelas: 2,
      recorrenciaId: null,
      opEntregaId: null,
      opSaldoId: null,
      insumoMovimentoId: null,
      baixas: [
        {
          id: 'b-1',
          valor: Dc(100),
          data: new Date(),
          forma: 'PIX',
          observacao: null,
          conta: { nome: 'Asaas' },
          estornadaEm: null,
        },
        {
          id: 'b-2',
          valor: Dc(50),
          data: new Date(),
          forma: 'PIX',
          observacao: null,
          conta: { nome: 'Asaas' },
          estornadaEm: new Date(),
        },
      ],
    });
    const r = await svc.ver(user as never, 't-1');
    expect(prisma.finTitulo.findFirst.mock.calls[0][0].where).toEqual({
      id: 't-1',
      empresaId: 'emp-1',
    });
    expect(r).toMatchObject({
      valor: 332.33,
      pago: 100,
      saldo: 232.33,
      automatico: true,
      recorrente: false,
    });
    expect(r.baixas.map((b) => b.id)).toEqual(['b-1', 'b-2']);
  });

  it('de outra empresa ou inexistente: 404', async () => {
    const { svc, prisma } = montar();
    prisma.finTitulo.findFirst.mockResolvedValue(null);
    await expect(svc.ver(user as never, 'x')).rejects.toThrow();
  });
});
