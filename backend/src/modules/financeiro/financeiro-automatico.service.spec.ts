import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  FinanceiroAutomaticoService,
  dividirEmParcelas,
  somarMeses,
} from './financeiro-automatico.service';

const D = (v: number) => new Prisma.Decimal(v);

/** Banco/tx falso: só o que o serviço usa. */
function montar(over: Record<string, unknown> = {}) {
  const tx = {
    pedido: { findUnique: vi.fn() },
    finTitulo: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 't-novo',
        status: 'ABERTO',
        ...data,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 't-1',
        ...data,
      })),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
    finBaixa: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { valor: null } }),
      count: vi.fn().mockResolvedValue(0),
    },
    finCategoria: {
      findUnique: vi.fn(
        async ({ where }: { where: { empresaId_tipo_nome: { nome: string } } }) => ({
          id: `cat-${where.empresaId_tipo_nome.nome}`,
        }),
      ),
    },
    finConta: { findFirst: vi.fn().mockResolvedValue({ id: 'conta-banco' }) },
    ordemProducao: { findUnique: vi.fn() },
    ordemProducaoEntrega: { findMany: vi.fn(), aggregate: vi.fn() },
    ordemProducaoItem: { aggregate: vi.fn() },
    insumoMovimento: { findUnique: vi.fn() },
    ...over,
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const fin = {
    ativoNaEmpresa: vi.fn().mockResolvedValue(true),
    garantirPadroes: vi.fn().mockResolvedValue(undefined),
    baixarNaTx: vi.fn().mockResolvedValue(undefined),
    reaplicarStatus: vi.fn().mockResolvedValue(undefined),
  };
  const svc = new FinanceiroAutomaticoService(prisma as never, fin as never);
  return { svc, tx, prisma, fin };
}

const pedidoVitrine = (over: Record<string, unknown> = {}) => ({
  id: 'ped-1',
  empresaId: 'emp-1',
  numero: 'PED-0007',
  origem: 'VITRINE',
  status: 'RASCUNHO',
  total: D(1234.5),
  clienteId: 'cli-1',
  contatoNome: 'Loja da Ana',
  criadoEm: new Date('2026-10-07T15:00:00Z'),
  cliente: { nome: 'Ana' },
  ...over,
});

describe('FinanceiroAutomaticoService', () => {
  it('financeiro desligado: preparar() diz não e não cria padrão nenhum', async () => {
    const { svc, fin } = montar();
    fin.ativoNaEmpresa.mockResolvedValue(false);
    await expect(svc.preparar('emp-1')).resolves.toBe(false);
    expect(fin.garantirPadroes).not.toHaveBeenCalled();
  });

  describe('pedido da vitrine → a receber', () => {
    it('cria 1 título (parcela 1) com valor, cliente e categoria Venda atacado', async () => {
      const { svc, tx } = montar();
      tx.pedido.findUnique.mockResolvedValue(pedidoVitrine());
      await svc.tituloDoPedidoNaTx(tx as never, 'ped-1');
      const data = tx.finTitulo.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        tipo: 'RECEBER',
        pedidoId: 'ped-1',
        parcela: 1,
        totalParcelas: 1,
        clienteId: 'cli-1',
        contatoNome: 'Loja da Ana',
        categoriaId: 'cat-Venda atacado',
      });
      expect(Number(data.valor)).toBe(1234.5);
      expect((data.vencimento as Date).toISOString().slice(0, 10)).toBe('2026-10-07');
    });

    it('pedido que não é da vitrine, cancelado ou só "sob consulta" (total 0): nada', async () => {
      for (const over of [{ origem: 'REP_APP' }, { status: 'CANCELADO' }, { total: D(0) }]) {
        const { svc, tx } = montar();
        tx.pedido.findUnique.mockResolvedValue(pedidoVitrine(over));
        await expect(svc.tituloDoPedidoNaTx(tx as never, 'ped-1')).resolves.toBeNull();
        expect(tx.finTitulo.create).not.toHaveBeenCalled();
      }
    });

    it('chamar de novo não duplica; total re-precificado atualiza o título ainda não pago', async () => {
      const { svc, tx } = montar();
      tx.pedido.findUnique.mockResolvedValue(pedidoVitrine({ total: D(1500) }));
      tx.finTitulo.findUnique.mockResolvedValue({
        id: 't-1',
        status: 'ABERTO',
        valor: D(1234.5),
        baixas: [],
      });
      await svc.tituloDoPedidoNaTx(tx as never, 'ped-1');
      expect(tx.finTitulo.create).not.toHaveBeenCalled();
      expect(Number(tx.finTitulo.update.mock.calls[0][0].data.valor)).toBe(1500);

      tx.finTitulo.update.mockClear();
      tx.finTitulo.findUnique.mockResolvedValue({
        id: 't-1',
        status: 'PARCIAL',
        valor: D(1234.5),
        baixas: [{ id: 'b' }],
      });
      await svc.tituloDoPedidoNaTx(tx as never, 'ped-1');
      expect(tx.finTitulo.update).not.toHaveBeenCalled(); // já tem recebimento: não mexe no valor
    });

    it('pagamento recebido: baixa o que falta, Pix, na conta Banco', async () => {
      const { svc, tx, fin } = montar();
      tx.pedido.findUnique.mockResolvedValue(pedidoVitrine());
      tx.finTitulo.findUnique.mockResolvedValue({
        id: 't-1',
        status: 'PARCIAL',
        valor: D(1234.5),
        baixas: [],
      });
      tx.finBaixa.aggregate.mockResolvedValue({ _sum: { valor: D(200) } });
      await svc.pagamentoRecebidoNaTx(tx as never, 'emp-1', 'ped-1', 'u-1');
      expect(fin.baixarNaTx).toHaveBeenCalledWith(
        tx,
        't-1',
        expect.objectContaining({ valor: 1034.5, contaId: 'conta-banco', forma: 'PIX' }),
        'u-1',
      );
    });

    it('pagamento recebido sem título (não nasceu na criação): cria e já baixa', async () => {
      const { svc, tx, fin } = montar();
      tx.pedido.findUnique.mockResolvedValue(pedidoVitrine());
      await svc.pagamentoRecebidoNaTx(tx as never, 'emp-1', 'ped-1', null);
      expect(tx.finTitulo.create).toHaveBeenCalled();
      expect(fin.baixarNaTx).toHaveBeenCalledWith(
        tx,
        't-novo',
        expect.objectContaining({ valor: 1234.5 }),
        null,
      );
    });

    it('cancelar: título sem recebimento vira CANCELADO; com recebimento fica (devolução é de gente)', async () => {
      const a = montar();
      a.prisma.finTitulo.findMany.mockResolvedValue([{ id: 't-1', status: 'ABERTO', baixas: [] }]);
      await a.svc.aoCancelarPedido('ped-1');
      expect(a.prisma.finTitulo.update).toHaveBeenCalledWith({
        where: { id: 't-1' },
        data: { status: 'CANCELADO' },
      });

      const b = montar();
      b.prisma.finTitulo.findMany.mockResolvedValue([
        { id: 't-1', status: 'QUITADO', baixas: [{ id: 'b1' }] },
      ]);
      await b.svc.aoCancelarPedido('ped-1');
      expect(b.prisma.finTitulo.update).not.toHaveBeenCalled();
    });

    it('cancelar pedido parcelado: cancela as parcelas sem recebimento, guarda a que recebeu', async () => {
      const { svc, prisma } = montar();
      prisma.finTitulo.findMany.mockResolvedValue([
        { id: 'p1', status: 'QUITADO', baixas: [{ id: 'b1' }] },
        { id: 'p2', status: 'ABERTO', baixas: [] },
        { id: 'p3', status: 'ABERTO', baixas: [] },
      ]);
      await svc.aoCancelarPedido('ped-1');
      const ids = (
        prisma.finTitulo.update.mock.calls as unknown as [{ where: { id: string } }][]
      ).map((c) => c[0].where.id);
      expect(ids).toEqual(['p2', 'p3']);
    });

    it('criação nunca derruba o pedido: erro no banco vira log', async () => {
      const { svc, prisma } = montar();
      prisma.$transaction.mockRejectedValue(new Error('banco fora'));
      await expect(svc.aoCriarPedidoVitrine('emp-1', 'ped-1')).resolves.toBeUndefined();
    });
  });

  describe('pagamento online (Asaas): um título por parcela', () => {
    const primeiro = new Date('2026-11-09T12:00:00.000Z');
    const tituloP1 = (over: Record<string, unknown> = {}) => ({
      id: 't-1',
      empresaId: 'emp-1',
      status: 'ABERTO',
      valor: D(1000),
      descricao: 'Pedido PED-0007 (vitrine)',
      categoriaId: 'cat-venda',
      contatoNome: 'Loja da Ana',
      clienteId: 'cli-1',
      totalParcelas: 1,
      baixas: [],
      ...over,
    });

    it('divide em centavos: a sobra vai nas primeiras e a soma bate', () => {
      expect(dividirEmParcelas(100, 3)).toEqual([33.34, 33.33, 33.33]);
      expect(dividirEmParcelas(1000, 1)).toEqual([1000]);
      const v = dividirEmParcelas(1234.57, 12);
      expect(Math.round(v.reduce((a, b) => a + b, 0) * 100)).toBe(123457);
    });

    it('mês seguinte: 31/jan → 28/fev (não pula pra março)', () => {
      const d = somarMeses(new Date('2027-01-31T12:00:00.000Z'), 1);
      expect(d.toISOString().slice(0, 10)).toBe('2027-02-28');
    });

    it('cartão 3x: a parcela 1 encolhe e nascem a 2 e a 3, um mês depois cada', async () => {
      const { svc, tx } = montar();
      tx.pedido.findUnique.mockResolvedValue(pedidoVitrine({ total: D(1000) }));
      tx.finTitulo.findUnique.mockResolvedValue(tituloP1());
      await svc.parcelarPedidoNaTx(tx as never, 'ped-1', 3, primeiro, 'cartão (Asaas)');
      expect(tx.finTitulo.update).toHaveBeenCalledWith({
        where: { id: 't-1' },
        data: {
          valor: expect.anything(),
          vencimento: primeiro,
          totalParcelas: 3,
          descricao: 'Pedido PED-0007 (vitrine) · 1/3 cartão (Asaas)',
        },
      });
      expect(Number(tx.finTitulo.update.mock.calls[0][0].data.valor)).toBe(333.34);
      const novos = tx.finTitulo.upsert.mock.calls.map((c) => c[0].create);
      expect(
        novos.map((n) => [n.parcela, Number(n.valor), n.vencimento.toISOString().slice(0, 10)]),
      ).toEqual([
        [2, 333.33, '2026-12-09'],
        [3, 333.33, '2027-01-09'],
      ]);
      expect(novos[0]).toMatchObject({ pedidoId: 'ped-1', totalParcelas: 3, tipo: 'RECEBER' });
    });

    it('09/10: cartão 3x com juros — as parcelas somam preço + juros (o que cai no Asaas)', async () => {
      const { svc, tx } = montar();
      tx.pedido.findUnique.mockResolvedValue(pedidoVitrine({ total: D(1000) }));
      tx.finTitulo.findUnique.mockResolvedValue(tituloP1());
      await svc.parcelarPedidoNaTx(tx as never, 'ped-1', 3, primeiro, 'cartão (Asaas)', 1030);
      expect(Number(tx.finTitulo.update.mock.calls[0][0].data.valor)).toBe(343.34);
      const novos = tx.finTitulo.upsert.mock.calls.map((c) => Number(c[0].create.valor));
      expect(novos).toEqual([343.33, 343.33]);
    });

    it('à vista: o mesmo título, vencendo no crédito previsto; repetir não empilha rótulo', async () => {
      const { svc, tx } = montar();
      tx.pedido.findUnique.mockResolvedValue(pedidoVitrine({ total: D(1000) }));
      tx.finTitulo.findUnique.mockResolvedValue(
        tituloP1({ descricao: 'Pedido PED-0007 (vitrine) · Pix (Asaas)' }),
      );
      await svc.parcelarPedidoNaTx(tx as never, 'ped-1', 1, primeiro, 'Pix (Asaas)');
      expect(tx.finTitulo.update.mock.calls[0][0].data.descricao).toBe(
        'Pedido PED-0007 (vitrine) · Pix (Asaas)',
      );
      expect(tx.finTitulo.upsert).not.toHaveBeenCalled();
    });

    it('título que já recebeu algo (baixa manual) não é dividido', async () => {
      const { svc, tx } = montar();
      tx.pedido.findUnique.mockResolvedValue(pedidoVitrine({ total: D(1000) }));
      tx.finTitulo.findUnique.mockResolvedValue(tituloP1());
      tx.finBaixa.count.mockResolvedValue(1);
      await svc.parcelarPedidoNaTx(tx as never, 'ped-1', 3, primeiro, 'cartão (Asaas)');
      expect(tx.finTitulo.update).not.toHaveBeenCalled();
      expect(tx.finTitulo.upsert).not.toHaveBeenCalled();
    });

    it('RECEBIDO da parcela 2: baixa o que falta DELA na conta Asaas', async () => {
      const { svc, tx, fin } = montar();
      tx.finTitulo.findUnique.mockResolvedValue({
        id: 't-2',
        status: 'ABERTO',
        valor: D(333.33),
        baixas: [],
      });
      await svc.parcelaAsaasNaTx(tx as never, 'emp-1', 'ped-1', 2, {
        recebido: true,
        forma: 'CARTAO',
        observacao: 'parcela 2/3',
      });
      expect(tx.finTitulo.findUnique.mock.calls[0][0].where).toEqual({
        pedidoId_parcela: { pedidoId: 'ped-1', parcela: 2 },
      });
      expect(tx.finConta.findFirst.mock.calls[0][0].where).toMatchObject({ nome: 'Asaas' });
      expect(fin.baixarNaTx).toHaveBeenCalledWith(
        tx,
        't-2',
        expect.objectContaining({ valor: 333.33, forma: 'CARTAO', contaId: 'conta-banco' }),
        null,
      );
    });

    it('CONFIRMADO (sem dinheiro ainda): só ajusta o vencimento, sem baixa', async () => {
      const { svc, tx, fin } = montar();
      tx.finTitulo.findUnique.mockResolvedValue({
        id: 't-2',
        status: 'ABERTO',
        valor: D(333.33),
        baixas: [],
      });
      const credito = new Date('2026-12-11T12:00:00.000Z');
      await svc.parcelaAsaasNaTx(tx as never, 'emp-1', 'ped-1', 2, {
        credito,
        recebido: false,
        forma: 'CARTAO',
        observacao: 'x',
      });
      expect(tx.finTitulo.update).toHaveBeenCalledWith({
        where: { id: 't-2' },
        data: { vencimento: credito },
      });
      expect(fin.baixarNaTx).not.toHaveBeenCalled();
    });

    it('RECEBIDO repetido (parcela já quitada) ou pedido cancelado: nada', async () => {
      const a = montar();
      a.tx.finTitulo.findUnique.mockResolvedValue({
        id: 't-2',
        status: 'QUITADO',
        valor: D(333.33),
        baixas: [{ valor: D(333.33) }],
      });
      await a.svc.parcelaAsaasNaTx(a.tx as never, 'emp-1', 'ped-1', 2, {
        recebido: true,
        forma: 'CARTAO',
        observacao: 'x',
      });
      expect(a.fin.baixarNaTx).not.toHaveBeenCalled();
      const b = montar();
      b.tx.finTitulo.findUnique.mockResolvedValue({
        id: 't-2',
        status: 'CANCELADO',
        valor: D(1),
        baixas: [],
      });
      await b.svc.parcelaAsaasNaTx(b.tx as never, 'emp-1', 'ped-1', 2, {
        recebido: true,
        forma: 'CARTAO',
        observacao: 'x',
      });
      expect(b.fin.baixarNaTx).not.toHaveBeenCalled();
    });
  });

  describe('facção → a pagar', () => {
    const op = {
      id: 'op-1',
      empresaId: 'emp-1',
      numero: 'OP-0003',
      faccaoId: 'fac-1',
      precoFaccaoPorPeca: D(4.5),
      faccao: { nome: 'Facção Maria' },
    };

    it('entrega: (boas + defeito) × preço, vence hoje, chave = 1ª linha da entrega', async () => {
      const { svc, tx } = montar();
      tx.ordemProducao.findUnique.mockResolvedValue(op);
      tx.ordemProducaoEntrega.findMany.mockResolvedValue([
        { quantidade: 30, defeito: 2 },
        { quantidade: 18, defeito: 0 },
      ]);
      await svc.entregaFaccaoNaTx(tx as never, 'op-1', ['e-b', 'e-a']);
      const data = tx.finTitulo.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        tipo: 'PAGAR',
        opEntregaId: 'e-a',
        faccaoId: 'fac-1',
        contatoNome: 'Facção Maria',
        categoriaId: 'cat-Facção',
      });
      expect(Number(data.valor)).toBe(225); // 50 peças × 4,50
    });

    it('entrega já lançada não duplica; OP sem preço de facção não gera nada', async () => {
      const a = montar();
      a.tx.finTitulo.findUnique.mockResolvedValue({ id: 't-1' });
      await a.svc.entregaFaccaoNaTx(a.tx as never, 'op-1', ['e-a']);
      expect(a.tx.finTitulo.create).not.toHaveBeenCalled();

      const b = montar();
      b.tx.ordemProducao.findUnique.mockResolvedValue({ ...op, precoFaccaoPorPeca: null });
      await expect(b.svc.entregaFaccaoNaTx(b.tx as never, 'op-1', ['e-a'])).resolves.toBeNull();
    });

    it('fechamento: saldo = enviadas que não voltaram × preço (entregas + saldo = custo da facção)', async () => {
      const { svc, tx } = montar();
      tx.ordemProducao.findUnique.mockResolvedValue(op);
      tx.ordemProducaoItem.aggregate.mockResolvedValue({ _sum: { enviada: 100 } });
      tx.ordemProducaoEntrega.aggregate.mockResolvedValue({ _sum: { quantidade: 88, defeito: 4 } });
      await svc.saldoFaccaoNaTx(tx as never, 'op-1');
      const data = tx.finTitulo.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ opSaldoId: 'op-1', tipo: 'PAGAR' });
      expect(Number(data.valor)).toBe(36); // 8 peças × 4,50; 92 já pagas nas entregas → 100 × 4,50
    });

    it('fechamento com tudo devolvido: sem saldo', async () => {
      const { svc, tx } = montar();
      tx.ordemProducao.findUnique.mockResolvedValue(op);
      tx.ordemProducaoItem.aggregate.mockResolvedValue({ _sum: { enviada: 50 } });
      tx.ordemProducaoEntrega.aggregate.mockResolvedValue({ _sum: { quantidade: 49, defeito: 1 } });
      await expect(svc.saldoFaccaoNaTx(tx as never, 'op-1')).resolves.toBeNull();
    });
  });

  describe('compra de insumo → a pagar', () => {
    const mov = (over: Record<string, unknown> = {}) => ({
      empresaId: 'emp-1',
      tipo: 'ENTRADA_COMPRA',
      quantidade: D(50),
      custoUnitario: D(12.3333),
      documento: 'NF 991',
      insumo: { nome: 'Tactel preto', tipo: 'TECIDO', fornecedor: 'Tecidos ABC' },
      ...over,
    });

    it('usa o valor TOTAL pago e o vencimento informado; categoria pelo tipo do insumo', async () => {
      const { svc, tx } = montar();
      tx.insumoMovimento.findUnique.mockResolvedValue(mov());
      await svc.compraInsumoNaTx(tx as never, 'mov-1', {
        vencimento: '2026-11-05',
        valorTotal: 616.67,
      });
      const data = tx.finTitulo.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        insumoMovimentoId: 'mov-1',
        contatoNome: 'Tecidos ABC',
        categoriaId: 'cat-Tecido',
      });
      expect(Number(data.valor)).toBe(616.67);
      expect((data.vencimento as Date).toISOString().slice(0, 10)).toBe('2026-11-05');
    });

    it('sem total informado: quantidade × custo; aviamento cai em Aviamento', async () => {
      const { svc, tx } = montar();
      tx.insumoMovimento.findUnique.mockResolvedValue(
        mov({
          quantidade: D(200),
          custoUnitario: D(0.35),
          insumo: { nome: 'Botão', tipo: 'AVIAMENTO', fornecedor: null },
        }),
      );
      await svc.compraInsumoNaTx(tx as never, 'mov-2');
      const data = tx.finTitulo.create.mock.calls[0][0].data;
      expect(Number(data.valor)).toBe(70);
      expect(data.categoriaId).toBe('cat-Aviamento');
    });

    it('movimento que não é compra, ou de valor zero: nada', async () => {
      for (const over of [{ tipo: 'PERDA' }, { custoUnitario: D(0) }]) {
        const { svc, tx } = montar();
        tx.insumoMovimento.findUnique.mockResolvedValue(mov(over));
        await expect(svc.compraInsumoNaTx(tx as never, 'mov-1')).resolves.toBeNull();
      }
    });
  });
});
