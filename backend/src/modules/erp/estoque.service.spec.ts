import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ajusteEstoqueSchema } from './estoque.dto';
import { EstoqueController } from './estoque.controller';
import { EstoqueService, MOTIVO_EXPIRADA } from './estoque.service';

const user = { id: 'u-1', role: 'DIRECTOR', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] };

function montar(opts: { ativo?: boolean } = {}) {
  const cfg = opts.ativo === false ? {} : { erpInterno: { ativo: true } };
  const prisma = {
    empresa: { findUnique: vi.fn().mockResolvedValue({ config: cfg }) },
    estoqueReserva: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    estoqueMovimento: {
      create: vi.fn().mockResolvedValue({ id: 'mov-1' }),
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
    pedido: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ped-1',
        numero: 'PED-0009',
        status: 'RASCUNHO',
        observacoes: null,
      }),
      findUnique: vi
        .fn()
        .mockResolvedValue({ status: 'RASCUNHO', observacoes: 'x', numero: 'PED-0009' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    pedidoItem: { findMany: vi.fn().mockResolvedValue([{ produtoId: 'p1', quantidade: 4 }]) },
    produto: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
    catalogoVariacao: { findMany: vi.fn().mockResolvedValue([]) },
    vitrine: { findUnique: vi.fn().mockResolvedValue({ respeitaEstoque: false }) },
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { svc: new EstoqueService(prisma as never), prisma };
}

describe('EstoqueService — isolamento', () => {
  it('só ADMIN e DIRECTOR passam pelo controller', () => {
    const roles = new Reflector().get<string[]>('roles', EstoqueController);
    expect([...roles].sort()).toEqual(['ADMIN', 'DIRECTOR']);
  });

  it('empresa SEM a flag: não reserva nada e as telas recusam', async () => {
    const { svc, prisma } = montar({ ativo: false });
    expect(
      await svc.reservarPedido('emp-1', 'ped-1', [{ produtoId: 'p1', quantidade: 2 }]),
    ).toBeNull();
    expect(prisma.estoqueReserva.createMany).not.toHaveBeenCalled();
    expect(await svc.status(user as never)).toEqual({ ativo: false });
    await expect(svc.saldos(user as never)).rejects.toBeInstanceOf(BusinessRuleException);
    await expect(
      svc.ajustar(user as never, {
        produtoId: 'p1',
        tipo: 'AJUSTE',
        quantidade: 5,
        motivo: 'contagem',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.estoqueMovimento.create).not.toHaveBeenCalled();
  });
});

describe('reserva do pedido da vitrine', () => {
  it('reserva por 20 minutos', async () => {
    const { svc, prisma } = montar();
    const antes = Date.now();
    const ate = await svc.reservarPedido('emp-1', 'ped-1', [{ produtoId: 'p1', quantidade: 2 }]);
    expect(ate!.getTime() - antes).toBeGreaterThanOrEqual(20 * 60_000 - 50);
    expect(ate!.getTime() - antes).toBeLessThan(20 * 60_000 + 1000);
    const data = prisma.estoqueReserva.createMany.mock.calls[0][0].data;
    expect(data).toEqual([
      expect.objectContaining({ produtoId: 'p1', quantidade: 2, status: 'ATIVA', expiraEm: ate }),
    ]);
  });

  it('despacho: reserva vira SAÍDA (quantidade negativa) e a reserva fica BAIXADA', async () => {
    const { svc, prisma } = montar();
    prisma.estoqueReserva.findMany.mockResolvedValue([
      { id: 'r1', empresaId: 'emp-1', produtoId: 'p1', quantidade: 3 },
    ]);
    expect(await svc.baixarNoDespacho('ped-1', 'u-1')).toBe(1);
    expect(prisma.estoqueMovimento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tipo: 'SAIDA_PEDIDO', quantidade: -3, pedidoId: 'ped-1' }),
    });
  });

  it('despacho concorrente: reserva já baixada por outra chamada NÃO gera segunda saída', async () => {
    const { svc, prisma } = montar();
    prisma.estoqueReserva.findMany.mockResolvedValue([
      { id: 'r1', empresaId: 'emp-1', produtoId: 'p1', quantidade: 3 },
    ]);
    prisma.estoqueReserva.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.baixarNoDespacho('ped-1', null)).toBe(0);
    expect(prisma.estoqueMovimento.create).not.toHaveBeenCalled();
  });

  it('pagamento recebido: reserva confirmada (sem prazo) e pedido PAGO', async () => {
    const { svc, prisma } = montar();
    await svc.pagamentoRecebido(user as never, 'ped-1');
    expect(prisma.estoqueReserva.updateMany).toHaveBeenCalledWith({
      where: { pedidoId: 'ped-1', status: 'ATIVA' },
      data: { status: 'CONFIRMADA', expiraEm: null },
    });
    expect(prisma.pedido.updateMany).toHaveBeenCalledWith({
      where: { id: 'ped-1', empresaId: 'emp-1', status: 'RASCUNHO' },
      data: { status: 'PAGO', pagoEm: expect.any(Date) },
    });
  });

  it('pagamento recebido sem reserva ativa: recusa (tem que reativar antes)', async () => {
    const { svc, prisma } = montar();
    prisma.estoqueReserva.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.pagamentoRecebido(user as never, 'ped-1')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(prisma.pedido.updateMany).not.toHaveBeenCalled();
  });

  it('pedido de OUTRA empresa: 404', async () => {
    const { svc, prisma } = montar();
    prisma.pedido.findFirst.mockResolvedValue(null);
    await expect(svc.pagamentoRecebido(user as never, 'ped-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('expirou: libera a reserva e cancela o pedido que ainda esperava pagamento', async () => {
    const { svc, prisma } = montar();
    prisma.estoqueReserva.findMany.mockResolvedValue([{ pedidoId: 'ped-1' }]);
    expect(await svc.expirarVencidas(new Date('2026-10-07T12:00:00Z'))).toBe(1);
    expect(prisma.estoqueReserva.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'LIBERADA', motivoLiberacao: MOTIVO_EXPIRADA }),
      }),
    );
    expect(prisma.pedido.updateMany).toHaveBeenCalledWith({
      where: { id: 'ped-1', status: 'RASCUNHO' },
      data: expect.objectContaining({ status: 'CANCELADO' }),
    });
  });

  it('expirou mas o pedido já foi pago: libera só a reserva, NÃO cancela', async () => {
    const { svc, prisma } = montar();
    prisma.estoqueReserva.findMany.mockResolvedValue([{ pedidoId: 'ped-1' }]);
    prisma.pedido.findUnique.mockResolvedValue({ status: 'PAGO', observacoes: null, numero: 'X' });
    expect(await svc.expirarVencidas()).toBe(0);
    expect(prisma.pedido.updateMany).not.toHaveBeenCalled();
  });

  it('reativar: só pedido cancelado por reserva expirada; volta com 20 min novos', async () => {
    const { svc, prisma } = montar();
    prisma.pedido.findFirst.mockResolvedValue({
      id: 'ped-1',
      numero: 'PED-0009',
      status: 'CANCELADO',
      observacoes: null,
    });
    prisma.estoqueReserva.findFirst.mockResolvedValue({ id: 'r-velha' });
    await svc.reativar(user as never, 'ped-1');
    expect(prisma.pedido.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RASCUNHO' }) }),
    );
    expect(prisma.estoqueReserva.createMany.mock.calls[0][0].data[0]).toMatchObject({
      produtoId: 'p1',
      quantidade: 4,
      status: 'ATIVA',
    });
  });

  it('reativar pedido cancelado à mão (não por expiração): recusa', async () => {
    const { svc, prisma } = montar();
    prisma.pedido.findFirst.mockResolvedValue({
      id: 'ped-1',
      numero: 'X',
      status: 'CANCELADO',
      observacoes: null,
    });
    await expect(svc.reativar(user as never, 'ped-1')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });
});

describe('saldo e ajuste', () => {
  it('disponível = físico (soma dos movimentos) − reservado válido', async () => {
    const { svc, prisma } = montar();
    prisma.catalogoVariacao.findMany.mockResolvedValue([
      {
        produtoId: 'p1',
        ativo: true,
        modelo: { id: 'm1', nome: 'Bermuda', ordem: 0 },
        modeloCor: { ordem: 0, cor: { nome: 'Preto', hex: '#000000' } },
        modeloLinha: { linha: { nome: 'Regular', ordem: 0 } },
        modeloTamanho: { tamanho: { nome: 'M', ordem: 1 } },
      },
    ]);
    prisma.estoqueMovimento.groupBy.mockResolvedValue([
      { produtoId: 'p1', _sum: { quantidade: 10 } },
    ]);
    prisma.estoqueReserva.groupBy.mockResolvedValue([{ produtoId: 'p1', _sum: { quantidade: 3 } }]);
    const [v] = await svc.saldos(user as never);
    expect(v).toMatchObject({ fisico: 10, reservado: 3, disponivel: 7 });
    // reserva vencida não conta: o filtro exige confirmada OU ativa dentro do prazo
    const where = prisma.estoqueReserva.groupBy.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { status: 'CONFIRMADA' },
      { status: 'ATIVA', expiraEm: { gt: expect.any(Date) } },
    ]);
  });

  it('ajuste vira MOVIMENTO com motivo e autor (saldo nunca é editado)', async () => {
    const { svc, prisma } = montar();
    await svc.ajustar(user as never, {
      produtoId: 'p1',
      tipo: 'AJUSTE',
      quantidade: -2,
      motivo: 'contagem',
    });
    expect(prisma.estoqueMovimento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantidade: -2, motivo: 'contagem', usuarioId: 'u-1' }),
      }),
    );
  });

  it('produto de OUTRA empresa: 404', async () => {
    const { svc, prisma } = montar();
    prisma.produto.findFirst.mockResolvedValue(null);
    await expect(
      svc.ajustar(user as never, { produtoId: 'px', tipo: 'AJUSTE', quantidade: 1, motivo: 'abc' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DTO: motivo obrigatório, zero não vale, devolução só entra', () => {
    const ok = { produtoId: 'p1', tipo: 'AJUSTE', quantidade: 3, motivo: 'contagem' };
    expect(ajusteEstoqueSchema.safeParse(ok).success).toBe(true);
    expect(ajusteEstoqueSchema.safeParse({ ...ok, motivo: '' }).success).toBe(false);
    expect(ajusteEstoqueSchema.safeParse({ ...ok, quantidade: 0 }).success).toBe(false);
    expect(
      ajusteEstoqueSchema.safeParse({ ...ok, tipo: 'DEVOLUCAO', quantidade: -1 }).success,
    ).toBe(false);
  });
});

describe('entrega 5 — trava, inventário, reposição', () => {
  it('trava os produtos em ordem fixa (FOR UPDATE) e recusa quem pede mais do que tem', async () => {
    const { svc, prisma } = montar();
    prisma.estoqueMovimento.groupBy.mockResolvedValue([
      { produtoId: 'p2', _sum: { quantidade: 5 } },
      { produtoId: 'p1', _sum: { quantidade: 1 } },
    ]);
    prisma.estoqueReserva.groupBy.mockResolvedValue([{ produtoId: 'p1', _sum: { quantidade: 1 } }]);
    (prisma as unknown as { produto: { findMany: unknown } }).produto.findMany = vi
      .fn()
      .mockResolvedValue([{ id: 'p1', nome: 'Short · Preto · M' }]);
    await expect(
      svc.travarEConferir(prisma as never, 'emp-1', [
        { produtoId: 'p2', quantidade: 2 },
        { produtoId: 'p1', quantidade: 1 },
      ]),
    ).rejects.toThrow(/Short · Preto · M \(restam 0\)/);
    const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
    expect(sql).toContain('FOR UPDATE');
    expect(prisma.$queryRaw.mock.calls[0][1].values).toEqual(['p1', 'p2']); // ordenado
  });

  it('com disponível suficiente, passa', async () => {
    const { svc, prisma } = montar();
    prisma.estoqueMovimento.groupBy.mockResolvedValue([
      { produtoId: 'p1', _sum: { quantidade: 3 } },
    ]);
    await expect(
      svc.travarEConferir(prisma as never, 'emp-1', [{ produtoId: 'p1', quantidade: 3 }]),
    ).resolves.toBeUndefined();
  });

  it('inventário: só a DIFERENÇA vira ajuste, com o motivo', async () => {
    const { svc, prisma } = montar();
    (prisma.catalogoVariacao as unknown as { count: unknown }).count = vi.fn().mockResolvedValue(3);
    prisma.estoqueMovimento.groupBy.mockResolvedValue([
      { produtoId: 'a', _sum: { quantidade: 10 } },
      { produtoId: 'b', _sum: { quantidade: 4 } },
    ]);
    const r = await svc.inventario(user as never, {
      contagens: [
        { produtoId: 'a', contado: 8 },
        { produtoId: 'b', contado: 4 },
        { produtoId: 'c', contado: 2 },
      ],
      motivo: 'Inventário de outubro',
    });
    expect(r).toEqual({ ajustes: 2, diferenca: 0, conferidas: 3 });
    const qs = prisma.estoqueMovimento.create.mock.calls.map((c) => [
      c[0].data.produtoId,
      c[0].data.quantidade,
      c[0].data.motivo,
    ]);
    expect(qs).toEqual([
      ['a', -2, 'Inventário de outubro'],
      ['c', 2, 'Inventário de outubro'],
    ]);
  });

  it('reposição: só quem tem mínimo e está abaixo dele, maior falta primeiro', async () => {
    const { svc, prisma } = montar();
    const v = (id: string, minimo: number | null) => ({
      produtoId: id,
      ativo: true,
      estoqueMinimo: minimo,
      modelo: { id: 'm', nome: 'Short', ordem: 0 },
      modeloCor: { ordem: 0, cor: { nome: 'Preto', hex: '#000' } },
      modeloLinha: { linha: { nome: 'Regular', ordem: 0 } },
      modeloTamanho: { tamanho: { nome: id, ordem: 0 } },
    });
    prisma.catalogoVariacao.findMany.mockResolvedValue([
      v('P', 10),
      v('M', 5),
      v('G', null),
      v('GG', 2),
    ]);
    prisma.estoqueMovimento.groupBy.mockResolvedValue([
      { produtoId: 'P', _sum: { quantidade: 4 } },
      { produtoId: 'M', _sum: { quantidade: 1 } },
      { produtoId: 'GG', _sum: { quantidade: 9 } },
    ]);
    const r = await svc.reposicao(user as never);
    expect(r.map((x) => [x.produtoId, x.repor])).toEqual([
      ['P', 6],
      ['M', 4],
    ]);
  });

  it('reativar com vitrine que respeita estoque: confere o disponível antes', async () => {
    const { svc, prisma } = montar();
    prisma.pedido.findFirst.mockResolvedValue({
      id: 'ped-1',
      numero: 'X',
      status: 'CANCELADO',
      observacoes: null,
    });
    prisma.estoqueReserva.findFirst.mockResolvedValue({ id: 'r-velha' });
    prisma.vitrine.findUnique.mockResolvedValue({ respeitaEstoque: true });
    const trava = vi
      .spyOn(svc, 'travarEConferir')
      .mockRejectedValue(new BusinessRuleException('acabou'));
    await expect(svc.reativar(user as never, 'ped-1')).rejects.toThrow('acabou');
    expect(trava).toHaveBeenCalled();
    expect(prisma.pedido.updateMany).not.toHaveBeenCalled();
  });
});

describe('EstoqueService → financeiro (Fase 3)', () => {
  const finMock = (ligado = true) => ({
    preparar: vi.fn().mockResolvedValue(ligado),
    pagamentoRecebidoNaTx: vi.fn().mockResolvedValue(undefined),
    aoCancelarPedido: vi.fn().mockResolvedValue(undefined),
    aoReativarPedidoNaTx: vi.fn().mockResolvedValue(undefined),
  });

  it('pagamento recebido baixa o título DENTRO da transação do pedido', async () => {
    const { prisma } = montar();
    const fin = finMock();
    const svc = new EstoqueService(prisma as never, fin as never);
    await svc.pagamentoRecebido(user as never, 'ped-1');
    // o tx do mock é o próprio prisma: chamou com ele = chamou dentro do $transaction
    expect(fin.pagamentoRecebidoNaTx).toHaveBeenCalledWith(prisma, 'emp-1', 'ped-1', 'u-1');
  });

  it('pagamento recebido dispara PEDIDO_PAGO (forma MANUAL) depois de gravar', async () => {
    const { prisma } = montar();
    const bus = { disparar: vi.fn().mockResolvedValue(undefined) };
    const moduleRef = { get: vi.fn().mockReturnValue(bus) };
    (prisma.pedido as unknown as { findUnique: unknown }).findUnique = vi.fn().mockResolvedValue({
      id: 'ped-1',
      empresaId: 'emp-1',
      numero: 'PED-0009',
      total: 300,
      origem: 'VITRINE',
      clienteId: 'cli-1',
      contatoNome: 'Loja',
      contatoTelefone: '5511900000000',
      representanteId: null,
      cliente: { id: 'cli-1', nome: 'Loja' },
    });
    const svc = new EstoqueService(prisma as never, finMock() as never, moduleRef as never);
    await svc.pagamentoRecebido(user as never, 'ped-1');
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'PEDIDO_PAGO',
      expect.objectContaining({ pagamento: { forma: 'MANUAL', parcelas: 1, online: false } }),
    );
  });

  it('sem o bus no contexto (teste/worker): o pagamento segue, sem disparo', async () => {
    const { prisma } = montar();
    const moduleRef = {
      get: vi.fn(() => {
        throw new Error('não registrado');
      }),
    };
    const svc = new EstoqueService(prisma as never, finMock() as never, moduleRef as never);
    await expect(svc.pagamentoRecebido(user as never, 'ped-1')).resolves.toBeTruthy();
  });

  it('financeiro desligado na empresa: não toca em título', async () => {
    const { prisma } = montar();
    const fin = finMock(false);
    await new EstoqueService(prisma as never, fin as never).pagamentoRecebido(
      user as never,
      'ped-1',
    );
    expect(fin.pagamentoRecebidoNaTx).not.toHaveBeenCalled();
  });

  it('reserva expirada que cancelou o pedido cancela o título; pedido já pago não', async () => {
    const a = montar();
    const finA = finMock();
    a.prisma.estoqueReserva.findMany.mockResolvedValue([{ pedidoId: 'ped-1' }]);
    await new EstoqueService(a.prisma as never, finA as never).expirarVencidas();
    expect(finA.aoCancelarPedido).toHaveBeenCalledWith('ped-1');

    const b = montar();
    const finB = finMock();
    b.prisma.estoqueReserva.findMany.mockResolvedValue([{ pedidoId: 'ped-1' }]);
    b.prisma.pedido.findUnique.mockResolvedValue({
      status: 'PAGO',
      observacoes: null,
      numero: 'PED-0009',
    });
    await new EstoqueService(b.prisma as never, finB as never).expirarVencidas();
    expect(finB.aoCancelarPedido).not.toHaveBeenCalled();
  });
});
