import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { opcoesCartao } from '@integrations/asaas/asaas.client';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { CheckoutPublicoService, RESERVA_PAGANDO_MIN } from './checkout-publico.service';

const D = (n: number) => new Prisma.Decimal(n);
const TAXAS = {
  cartao: { fixa: 0.49, umaVez: 2.99, ateSeis: 3.49, ateDoze: 3.99 },
  pix: { percentual: null, fixa: 1.99, minima: null, maxima: null },
};

const pedidoBase = {
  id: 'ped-1',
  empresaId: 'emp-1',
  numero: 'PED-0007',
  status: 'RASCUNHO',
  total: D(1000),
  contatoNome: 'Loja da Ana',
  contatoTelefone: '5511987654321',
  contatoEmail: null,
  clienteId: 'cli-1',
  cliente: { nome: 'Loja da Ana', cnpj: null },
  itens: [{ precoUnitario: D(45) }],
  empresa: { nome: 'Ribelt', config: { checkout: { ativo: true, taxas: TAXAS } } },
};

function montar(
  opts: {
    pedido?: unknown;
    configEmpresa?: unknown;
    pagamentos?: unknown[];
    evento?: unknown;
    pedidoNaTx?: { numero: string; status: string } | null;
    casCount?: number;
    comFin?: boolean;
  } = {},
) {
  const pagamentos = opts.pagamentos ?? [];
  const tx = {
    pedidoPagamento: { updateMany: vi.fn().mockResolvedValue({ count: opts.casCount ?? 1 }) },
    pedido: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.pedidoNaTx === undefined
            ? { numero: 'PED-0007', status: 'RASCUNHO' }
            : opts.pedidoNaTx,
        ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    estoqueReserva: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    pedido: {
      findFirst: vi.fn().mockResolvedValue(opts.pedido === undefined ? pedidoBase : opts.pedido),
      // Pro contexto do gatilho PEDIDO_PAGO.
      findUnique: vi.fn().mockResolvedValue({
        id: 'ped-1',
        empresaId: 'emp-1',
        numero: 'PED-0007',
        total: D(1000),
        origem: 'VITRINE',
        clienteId: 'cli-1',
        contatoNome: 'Loja da Ana',
        contatoTelefone: '5511987654321',
        representanteId: null,
        cliente: { id: 'cli-1', nome: 'Loja da Ana' },
      }),
    },
    // Juros do parcelado: config da empresa e o preço do pedido na cobrança.
    empresa: { findUnique: vi.fn().mockResolvedValue({ config: opts.configEmpresa ?? {} }) },
    pedidoPagamento: {
      findUnique: vi.fn().mockResolvedValue({ valorPedido: D(1000) }),
      // Ordem das leituras no iniciar: cobrança aberta → pagamentoAtual.
      findFirst: vi.fn(async () => pagamentos.shift() ?? null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    cliente: { update: vi.fn().mockResolvedValue({}) },
    estoqueReserva: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    asaasEvento: {
      findUnique: vi.fn().mockResolvedValue(opts.evento ?? null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const integracoes = {
    obterCredenciaisInternas: vi
      .fn()
      .mockResolvedValue({ credenciais: { apiKey: '$aact_hmlg_x' } }),
  };
  const env = { get: (k: string) => (k === 'ENCRYPTION_KEY' ? 'k'.repeat(64) : undefined) };
  const fin = {
    preparar: vi.fn().mockResolvedValue(opts.comFin ?? true),
    pagamentoRecebidoNaTx: vi.fn().mockResolvedValue(undefined),
    parcelarPedidoNaTx: vi.fn().mockResolvedValue(undefined),
    parcelaAsaasNaTx: vi.fn().mockResolvedValue(undefined),
  };
  const bus = { disparar: vi.fn().mockResolvedValue(undefined) };
  const notif = { criarParaRole: vi.fn().mockResolvedValue(1) };
  const asaas = {
    acharCliente: vi.fn().mockResolvedValue(null),
    criarCliente: vi.fn().mockResolvedValue({ id: 'cus_1' }),
    criarCobranca: vi.fn().mockResolvedValue({
      id: 'pay_1',
      status: 'PENDING',
      value: 1000,
      billingType: 'PIX',
      invoiceUrl: 'https://sandbox.asaas.com/i/pay_1',
    }),
    pixQrCode: vi.fn().mockResolvedValue({
      encodedImage: 'iVBOR',
      payload: '000201pix',
      expirationDate: '2026-10-08 23:59:59',
    }),
    cancelarCobranca: vi.fn().mockResolvedValue({ deleted: true }),
  };
  class Svc extends CheckoutPublicoService {
    protected override cliente() {
      return asaas as never;
    }
  }
  const svc = new Svc(
    prisma as never,
    integracoes as never,
    env as never,
    fin as never,
    notif as never,
    bus as never,
  );
  return { svc, prisma, tx, asaas, fin, notif, bus };
}

const pagPix = {
  id: 'pg-1',
  empresaId: 'emp-1',
  pedidoId: 'ped-1',
  metodo: 'PIX',
  parcelas: 1,
  valorCobrado: D(1000),
  status: 'PENDENTE',
  asaasCobrancaId: 'pay_1',
  invoiceUrl: 'https://sandbox.asaas.com/i/pay_1',
};

describe('opcoesCartao — regra do Léo (07/10)', () => {
  it('1x = preço da vitrine (a empresa cobre a taxa)', () => {
    expect(opcoesCartao(100000, TAXAS)[0]).toEqual({
      parcelas: 1,
      totalC: 100000,
      parcelaC: 100000,
    });
  });

  it('parcelado: o cliente paga a taxa — líquido volta ao preço do pedido', () => {
    const ops = opcoesCartao(100000, TAXAS);
    expect(ops).toHaveLength(12);
    for (const o of ops.slice(1)) {
      const pct = (o.parcelas <= 6 ? 3.49 : 3.99) / 100;
      const liquido = o.totalC * (1 - pct) - 49;
      expect(liquido).toBeGreaterThanOrEqual(100000);
      expect(liquido).toBeLessThan(100001); // arredonda pra cima, no máximo 1 centavo
    }
    // 2x–6x mesma faixa; 7x em diante mais caro
    expect(ops[1].totalC).toBe(ops[5].totalC);
    expect(ops[6].totalC).toBeGreaterThan(ops[5].totalC);
  });

  it('09/10: 1% ao mês × parcelas (simples) + a taxa do Asaas por cima; 1x continua sem acréscimo', () => {
    const ops = opcoesCartao(100000, TAXAS, 12, 1);
    expect(ops[0].totalC).toBe(100000);
    for (const o of ops.slice(1)) {
      const pct = (o.parcelas <= 6 ? 3.49 : 3.99) / 100;
      const liquido = o.totalC * (1 - pct) - 49;
      // Depois da taxa do Asaas, sobra o preço + 1% por parcela.
      const alvo = 100000 * (1 + 0.01 * o.parcelas);
      expect(liquido).toBeGreaterThanOrEqual(alvo);
      expect(liquido).toBeLessThan(alvo + 1);
    }
    // R$ 1.000 em 6x: R$ 1.060 líquidos → (106000 + 49) ÷ 0,9651, pra cima.
    expect(ops[5].totalC).toBe(Math.ceil((106000 + 49) / (1 - 0.0349)));
  });
});

describe('CheckoutPublicoService — código do pedido', () => {
  it('sem o código certo: 404, igual a pedido inexistente (não revela nada)', async () => {
    const { svc, prisma } = montar();
    await expect(svc.opcoes('atacado-ribelt', 'ped-1', 'errado')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.opcoes('atacado-ribelt', 'ped-1', undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // código de OUTRO pedido também não abre
    await expect(
      svc.opcoes('atacado-ribelt', 'ped-1', svc.tokenDoPedido('ped-2')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.pedido.findFirst).not.toHaveBeenCalled();
  });

  it('busca só pedido da VITRINE daquele slug', async () => {
    const { svc, prisma } = montar();
    await svc.opcoes('atacado-ribelt', 'ped-1', svc.tokenDoPedido('ped-1'));
    expect(prisma.pedido.findFirst.mock.calls[0][0].where).toEqual({
      id: 'ped-1',
      origem: 'VITRINE',
      empresa: { vitrine: { slug: 'atacado-ribelt' } },
    });
  });
});

describe('CheckoutPublicoService.opcoes', () => {
  it('Pix = valor do pedido; cartão 1x–12x', async () => {
    const { svc } = montar();
    const r = await svc.opcoes('atacado-ribelt', 'ped-1', svc.tokenDoPedido('ped-1'));
    expect(r.disponivel).toBe(true);
    expect(r.pix.valor).toBe(1000);
    expect(r.cartao[0]).toEqual({ parcelas: 1, total: 1000, parcela: 1000 });
    expect(r.cartao).toHaveLength(12);
    expect(r.pagamento).toBeNull();
  });

  it('item com preço a confirmar: não oferece pagar online', async () => {
    const { svc } = montar({ pedido: { ...pedidoBase, itens: [{ precoUnitario: D(0) }] } });
    const r = await svc.opcoes('atacado-ribelt', 'ped-1', svc.tokenDoPedido('ped-1'));
    expect(r.disponivel).toBe(false);
    expect(r.motivo).toMatch(/preço a confirmar/);
  });

  it('frete a combinar: não oferece pagar online (o total não tem o frete)', async () => {
    const { svc } = montar({
      pedido: { ...pedidoBase, entrega: { cep: '88350000', freteAConfirmar: true } },
    });
    const r = await svc.opcoes('atacado-ribelt', 'ped-1', svc.tokenDoPedido('ped-1'));
    expect(r.disponivel).toBe(false);
    expect(r.motivo).toMatch(/frete vai ser combinado/);
  });

  it('pedido cancelado (reserva expirou): não oferece', async () => {
    const { svc } = montar({ pedido: { ...pedidoBase, status: 'CANCELADO' } });
    const r = await svc.opcoes('atacado-ribelt', 'ped-1', svc.tokenDoPedido('ped-1'));
    expect(r.disponivel).toBe(false);
  });
});

describe('CheckoutPublicoService.iniciar', () => {
  const tk = (svc: CheckoutPublicoService) => svc.tokenDoPedido('ped-1');

  it('Pix: cobra o VALOR DO PEDIDO, guarda a cobrança e estica a reserva', async () => {
    const { svc, prisma, asaas } = montar({ pagamentos: [null, pagPix] });
    const antes = Date.now();
    const r = await svc.iniciar('atacado-ribelt', 'ped-1', {
      token: tk(svc),
      metodo: 'PIX',
      cpfCnpj: '12.345.678/0001-90',
    });

    expect(asaas.criarCliente).toHaveBeenCalledWith(
      expect.objectContaining({ cpfCnpj: '12345678000190', mobilePhone: '11987654321' }),
    );
    const cob = asaas.criarCobranca.mock.calls[0][0];
    expect(cob).toMatchObject({
      customer: 'cus_1',
      billingType: 'PIX',
      value: 1000,
      externalReference: 'ped-1',
    });
    expect(cob.installmentCount).toBeUndefined();
    const data = prisma.pedidoPagamento.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ metodo: 'PIX', parcelas: 1, asaasCobrancaId: 'pay_1' });
    expect(Number(data.valorCobrado)).toBe(1000);
    // documento entra no cadastro que estava sem
    expect(prisma.cliente.update).toHaveBeenCalledWith({
      where: { id: 'cli-1' },
      data: { cnpj: '12345678000190' },
    });
    const exp = prisma.estoqueReserva.updateMany.mock.calls[0][0].data.expiraEm as Date;
    expect(exp.getTime()).toBeGreaterThanOrEqual(antes + RESERVA_PAGANDO_MIN * 60_000);
    expect(r.pix).toEqual({
      payload: '000201pix',
      imagem: 'iVBOR',
      expiraEm: '2026-10-08 23:59:59',
    });
  });

  it('cartão 1x: preço da vitrine (sem acréscimo)', async () => {
    const { svc, asaas } = montar({ pagamentos: [null, { ...pagPix, metodo: 'CARTAO' }] });
    await svc.iniciar('atacado-ribelt', 'ped-1', {
      token: tk(svc),
      metodo: 'CARTAO',
      parcelas: 1,
      cpfCnpj: '123.456.789-09',
    });
    expect(asaas.criarCobranca.mock.calls[0][0]).toMatchObject({
      billingType: 'CREDIT_CARD',
      value: 1000,
    });
  });

  it('cartão 3x: parcelamento com o total que cobre a taxa', async () => {
    const { svc, asaas } = montar({ pagamentos: [null, { ...pagPix, metodo: 'CARTAO' }] });
    await svc.iniciar('atacado-ribelt', 'ped-1', {
      token: tk(svc),
      metodo: 'CARTAO',
      parcelas: 3,
      cpfCnpj: '12345678909',
    });
    const esperado = opcoesCartao(100000, TAXAS)[2].totalC / 100;
    expect(asaas.criarCobranca.mock.calls[0][0]).toMatchObject({
      billingType: 'CREDIT_CARD',
      installmentCount: 3,
      totalValue: esperado,
    });
    expect(esperado).toBeGreaterThan(1000);
  });

  it('mesma escolha com cobrança aberta: reaproveita, não cria outra', async () => {
    const { svc, asaas, prisma } = montar({ pagamentos: [pagPix, pagPix] });
    await svc.iniciar('atacado-ribelt', 'ped-1', {
      token: tk(svc),
      metodo: 'PIX',
      cpfCnpj: '12345678909',
    });
    expect(asaas.criarCobranca).not.toHaveBeenCalled();
    expect(prisma.pedidoPagamento.create).not.toHaveBeenCalled();
  });

  it('trocou de Pix pra cartão: cancela a cobrança antiga no Asaas', async () => {
    const { svc, asaas, prisma } = montar({ pagamentos: [pagPix, null] });
    await svc.iniciar('atacado-ribelt', 'ped-1', {
      token: tk(svc),
      metodo: 'CARTAO',
      parcelas: 2,
      cpfCnpj: '12345678909',
    });
    expect(asaas.cancelarCobranca).toHaveBeenCalledWith('pay_1');
    expect(prisma.pedidoPagamento.update).toHaveBeenCalledWith({
      where: { id: 'pg-1' },
      data: { status: 'CANCELADO' },
    });
    expect(asaas.criarCobranca).toHaveBeenCalled();
  });

  it('recusa: documento inválido, pedido já pago, loja desligada', async () => {
    const a = montar();
    await expect(
      a.svc.iniciar('atacado-ribelt', 'ped-1', { token: tk(a.svc), metodo: 'PIX', cpfCnpj: '123' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);

    const b = montar({ pedido: { ...pedidoBase, status: 'PAGO' } });
    await expect(
      b.svc.iniciar('atacado-ribelt', 'ped-1', {
        token: tk(b.svc),
        metodo: 'PIX',
        cpfCnpj: '12345678909',
      }),
    ).rejects.toThrow(/já está pago/);

    const c = montar({
      pedido: {
        ...pedidoBase,
        empresa: { nome: 'Ribelt', config: { checkout: { ativo: false } } },
      },
    });
    await expect(
      c.svc.iniciar('atacado-ribelt', 'ped-1', {
        token: tk(c.svc),
        metodo: 'PIX',
        cpfCnpj: '12345678909',
      }),
    ).rejects.toThrow(/desligado/);
    expect(c.asaas.criarCobranca).not.toHaveBeenCalled();
  });
});

describe('CheckoutPublicoService — aviso do Asaas → pedido pago', () => {
  const evento = (
    tipo: string,
    payment: Record<string, unknown> = { id: 'pay_1', netValue: 980.1 },
  ) => ({
    id: 'evt_1',
    empresaId: 'emp-1',
    evento: tipo,
    processadoEm: null,
    payload: { event: tipo, payment },
  });

  beforeEach(() => vi.clearAllMocks());

  it('PAYMENT_CONFIRMED: reserva CONFIRMADA, pedido PAGO, título no crédito previsto, aviso ALTA, PEDIDO_PAGO', async () => {
    const { svc, prisma, tx, fin, notif, bus } = montar({
      evento: evento('PAYMENT_CONFIRMED'),
      pagamentos: [pagPix],
    });
    await svc.processar('evt_1');

    expect(tx.pedidoPagamento.updateMany.mock.calls[0][0].where).toEqual({
      id: 'pg-1',
      status: { not: 'PAGO' },
    });
    expect(Number(tx.pedidoPagamento.updateMany.mock.calls[0][0].data.valorLiquido)).toBe(980.1);
    expect(tx.estoqueReserva.updateMany).toHaveBeenCalledWith({
      where: { pedidoId: 'ped-1', status: 'ATIVA' },
      data: { status: 'CONFIRMADA', expiraEm: null },
    });
    expect(tx.pedido.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'ped-1', status: 'RASCUNHO' },
      data: { status: 'PAGO' },
    });
    // Título: à vista, vencendo no crédito; a BAIXA só vem com o RECEBIDO.
    expect(fin.parcelarPedidoNaTx).toHaveBeenCalledWith(
      tx,
      'ped-1',
      1,
      expect.any(Date),
      'Pix (Asaas)',
      undefined, // Pix: sem juros
    );
    expect(fin.pagamentoRecebidoNaTx).not.toHaveBeenCalled();
    expect(fin.parcelaAsaasNaTx).toHaveBeenCalledWith(
      tx,
      'emp-1',
      'ped-1',
      1,
      expect.objectContaining({ recebido: false, forma: 'PIX' }),
    );
    // Gatilho dos fluxos, uma vez, com o contexto do pedido.
    expect(bus.disparar).toHaveBeenCalledTimes(1);
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'PEDIDO_PAGO',
      expect.objectContaining({
        pedidoId: 'ped-1',
        telefone: '5511987654321',
        pagamento: { forma: 'PIX', parcelas: 1, online: true },
      }),
    );
    expect(notif.criarParaRole.mock.calls[0][0]).toMatchObject({ prioridade: 'ALTA' });
    expect(notif.criarParaRole.mock.calls[0][0].titulo).toMatch(/PED-0007 PAGO online \(Pix\)/);
    expect(prisma.asaasEvento.update).toHaveBeenCalledWith({
      where: { id: 'evt_1' },
      data: { processadoEm: expect.any(Date), erro: null },
    });
  });

  it('aviso repetido processando junto: o segundo não confirma, não avisa, não dispara', async () => {
    const { svc, tx, fin, notif, bus } = montar({
      evento: evento('PAYMENT_RECEIVED'),
      pagamentos: [pagPix],
      casCount: 0,
    });
    await svc.processar('evt_1');
    expect(tx.pedido.updateMany).not.toHaveBeenCalled();
    expect(fin.parcelarPedidoNaTx).not.toHaveBeenCalled();
    expect(notif.criarParaRole).not.toHaveBeenCalled();
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('parcela seguinte do parcelamento (pagamento já PAGO): não reconfirma, só cuida DA parcela', async () => {
    const { svc, prisma, tx, fin, bus } = montar({
      evento: evento('PAYMENT_CONFIRMED', {
        id: 'pay_2',
        installment: 'ins_1',
        installmentNumber: 2,
        estimatedCreditDate: '2026-12-11',
      }),
      pagamentos: [{ ...pagPix, status: 'PAGO', metodo: 'CARTAO', parcelas: 3 }],
    });
    await svc.processar('evt_1');
    expect(tx.pedidoPagamento.updateMany).not.toHaveBeenCalled();
    expect(fin.parcelarPedidoNaTx).not.toHaveBeenCalled();
    expect(bus.disparar).not.toHaveBeenCalled();
    expect(fin.parcelaAsaasNaTx).toHaveBeenCalledWith(tx, 'emp-1', 'ped-1', 2, {
      credito: new Date('2026-12-11T12:00:00.000Z'),
      recebido: false,
      forma: 'CARTAO',
      observacao: 'Cartão parcela 2/3 recebido pelo Asaas',
    });
    expect(prisma.pedidoPagamento.findFirst).toHaveBeenCalledWith({
      where: { empresaId: 'emp-1', OR: expect.any(Array) },
    });
    const filtro = (
      prisma.pedidoPagamento.findFirst.mock.calls as unknown as [{ where: { OR: unknown[] } }][]
    )[0][0];
    expect(filtro.where.OR).toEqual([
      { asaasCobrancaId: 'pay_2' },
      { asaasParcelamentoId: 'ins_1' },
    ]);
  });

  it('cartão 3x confirmado: título dividido em 3 a partir do crédito previsto da 1ª', async () => {
    const { svc, tx, fin, bus } = montar({
      evento: evento('PAYMENT_CONFIRMED', {
        id: 'pay_1',
        installment: 'ins_1',
        installmentNumber: 1,
        estimatedCreditDate: '2026-11-09',
      }),
      pagamentos: [{ ...pagPix, metodo: 'CARTAO', parcelas: 3, asaasParcelamentoId: 'ins_1' }],
    });
    await svc.processar('evt_1');
    expect(fin.parcelarPedidoNaTx).toHaveBeenCalledWith(
      tx,
      'ped-1',
      3,
      new Date('2026-11-09T12:00:00.000Z'),
      'cartão (Asaas)',
      undefined, // empresa sem juros configurado
    );
    expect(bus.disparar.mock.calls[0][2].pagamento).toEqual({
      forma: 'CARTAO',
      parcelas: 3,
      online: true,
    });
  });

  it('09/10: cartão 3x com 1% a.m. — as parcelas a receber somam preço + juros', async () => {
    const { svc, tx, fin } = montar({
      evento: evento('PAYMENT_CONFIRMED', {
        id: 'pay_1',
        installment: 'ins_1',
        installmentNumber: 1,
        estimatedCreditDate: '2026-11-09',
      }),
      pagamentos: [{ ...pagPix, metodo: 'CARTAO', parcelas: 3, asaasParcelamentoId: 'ins_1' }],
      configEmpresa: { checkout: { ativo: true, jurosMesPct: 1 } },
    });
    await svc.processar('evt_1');
    expect(fin.parcelarPedidoNaTx).toHaveBeenCalledWith(
      tx,
      'ped-1',
      3,
      expect.any(Date),
      'cartão (Asaas)',
      1030, // R$ 1.000 × (1 + 1% × 3)
    );
  });

  it('PAYMENT_RECEIVED da parcela 3: baixa DELA (recebido = true)', async () => {
    const { svc, tx, fin } = montar({
      evento: evento('PAYMENT_RECEIVED', {
        id: 'pay_3',
        installment: 'ins_1',
        installmentNumber: 3,
        creditDate: '2027-01-09',
      }),
      pagamentos: [{ ...pagPix, status: 'PAGO', metodo: 'CARTAO', parcelas: 3 }],
    });
    await svc.processar('evt_1');
    expect(fin.parcelaAsaasNaTx).toHaveBeenCalledWith(
      tx,
      'emp-1',
      'ped-1',
      3,
      expect.objectContaining({ recebido: true, credito: new Date('2027-01-09T12:00:00.000Z') }),
    );
  });

  it('pedido já CANCELADO (reserva expirou) e o Pix caiu: não reativa sozinho — avisa', async () => {
    const { svc, tx, fin, notif } = montar({
      evento: evento('PAYMENT_RECEIVED'),
      pagamentos: [pagPix],
      pedidoNaTx: { numero: 'PED-0007', status: 'CANCELADO' },
    });
    await svc.processar('evt_1');
    expect(tx.pedido.updateMany).not.toHaveBeenCalled();
    expect(fin.parcelarPedidoNaTx).not.toHaveBeenCalled();
    expect(notif.criarParaRole.mock.calls[0][0].titulo).toMatch(/CANCELADO — reative ou estorne/);
  });

  it('pedido já marcado PAGO à mão: avisa possível cobrança em dobro', async () => {
    const { svc, fin, notif } = montar({
      evento: evento('PAYMENT_RECEIVED'),
      pagamentos: [pagPix],
      pedidoNaTx: { numero: 'PED-0007', status: 'PAGO' },
    });
    await svc.processar('evt_1');
    expect(fin.parcelarPedidoNaTx).not.toHaveBeenCalled();
    expect(notif.criarParaRole.mock.calls[0][0].titulo).toMatch(/duas vezes/);
  });

  it('cobrança que não é de pedido da vitrine: só marca o aviso como processado', async () => {
    const { svc, prisma } = montar({ evento: evento('PAYMENT_CONFIRMED'), pagamentos: [null] });
    await svc.processar('evt_1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.asaasEvento.update.mock.calls[0][0].data.processadoEm).toBeInstanceOf(Date);
  });

  it('estorno: pagamento ESTORNADO + aviso pra equipe', async () => {
    const { svc, prisma, notif } = montar({
      evento: evento('PAYMENT_REFUNDED'),
      pagamentos: [{ ...pagPix, status: 'PAGO' }],
    });
    await svc.processar('evt_1');
    expect(prisma.pedidoPagamento.update).toHaveBeenCalledWith({
      where: { id: 'pg-1' },
      data: { status: 'ESTORNADO' },
    });
    expect(notif.criarParaRole).toHaveBeenCalled();
  });

  it('falha no meio: grava o erro e NÃO marca processado (o job tenta de novo)', async () => {
    const { svc, prisma } = montar({ evento: evento('PAYMENT_CONFIRMED'), pagamentos: [pagPix] });
    prisma.$transaction.mockRejectedValueOnce(new Error('deadlock'));
    await svc.processar('evt_1');
    expect(prisma.asaasEvento.update).toHaveBeenCalledTimes(1);
    expect(prisma.asaasEvento.update.mock.calls[0][0].data).toEqual({ erro: 'Error: deadlock' });
  });

  it('aviso já processado: não faz nada', async () => {
    const { svc, prisma } = montar({
      evento: { ...evento('PAYMENT_CONFIRMED'), processadoEm: new Date() },
    });
    await svc.processar('evt_1');
    expect(prisma.pedidoPagamento.findFirst).not.toHaveBeenCalled();
  });
});

describe('CheckoutPublicoService — juros do parcelado (09/10)', () => {
  const comJuros = {
    ...pedidoBase,
    empresa: {
      nome: 'Ribelt',
      config: { checkout: { ativo: true, taxas: TAXAS, jurosMesPct: 1 } },
    },
  };

  it('as opções da tela e a cobrança no Asaas usam o MESMO valor com juros', async () => {
    const { svc, asaas } = montar({ pedido: comJuros });
    const r = await svc.opcoes('atacado-ribelt', 'ped-1', svc.tokenDoPedido('ped-1'));
    const tres = opcoesCartao(100000, TAXAS, 12, 1)[2].totalC / 100;
    expect(r.cartao[2]).toMatchObject({ parcelas: 3, total: tres });
    await svc.iniciar('atacado-ribelt', 'ped-1', {
      token: svc.tokenDoPedido('ped-1'),
      metodo: 'CARTAO',
      parcelas: 3,
      cpfCnpj: '12345678909',
    });
    expect(asaas.criarCobranca.mock.calls[0][0]).toMatchObject({ totalValue: tres });
    expect(tres).toBeGreaterThan(opcoesCartao(100000, TAXAS)[2].totalC / 100);
  });

  it('Pix não leva juros', async () => {
    const { svc } = montar({ pedido: comJuros });
    const r = await svc.opcoes('atacado-ribelt', 'ped-1', svc.tokenDoPedido('ped-1'));
    expect(r.pix.valor).toBe(1000);
  });
});
