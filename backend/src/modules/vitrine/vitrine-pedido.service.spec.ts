import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import {
  VitrinePedidoService,
  faixaDoTotal,
  minimoDaVitrine,
  normalizarWhatsapp,
  precoNaFaixa,
} from './vitrine-pedido.service';
import { pedidoVitrineSchema } from './vitrine.dto';

const D = (n: number) => new Prisma.Decimal(n);

const variacao = (corId: string, tamanhoId: string, produtoId: string, precos = {}) => ({
  modeloCorId: corId,
  modeloTamanhoId: tamanhoId,
  produtoId,
  modelo: { nome: 'Bermuda' },
  modeloCor: { cor: { nome: 'Preto' } },
  modeloLinha: {
    precoEntrada: D(45),
    precoVolume: D(41),
    precoAtacadao: null,
    linha: { nome: 'Regular' },
    ...precos,
  },
  modeloTamanho: { tamanho: { nome: tamanhoId.toUpperCase() } },
});

const vitrineOk = {
  ativa: true,
  empresaId: 'emp-1',
  minimoEntrada: 5,
  minimoVolume: 50,
  minimoAtacadao: 500,
  empresa: { ativo: true },
};

function montar(
  opts: {
    vitrine?: unknown;
    variacoes?: unknown[];
    recente?: unknown;
    clientes?: unknown[];
    reservaAte?: Date;
    checkout?: unknown;
  } = {},
) {
  const prisma = {
    vitrine: { findUnique: vi.fn().mockResolvedValue(opts.vitrine ?? vitrineOk) },
    catalogoVariacao: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          opts.variacoes ?? [variacao('c1', 'p', 'prod-p'), variacao('c1', 'm', 'prod-m')],
        ),
    },
    pedido: {
      findFirst: vi.fn().mockResolvedValue(opts.recente ?? null),
      create: vi.fn().mockResolvedValue({ id: 'ped-1', numero: 'PED-0007' }),
    },
    cliente: {
      findUnique: vi.fn().mockResolvedValue({ cnpj: null, telefone: null, cidade: null, uf: null }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 'cli-novo' }),
    },
    $queryRaw: vi.fn().mockResolvedValue(opts.clientes ?? []),
  };
  const bus = { disparar: vi.fn().mockResolvedValue(undefined) };
  const notif = { criarParaRole: vi.fn().mockResolvedValue(1) };
  const seq = { next: vi.fn().mockResolvedValue(7) };
  const estoque = {
    reservarPedido: vi.fn().mockResolvedValue(opts.reservaAte ?? null),
    vitrineRespeitaEstoque: vi.fn().mockResolvedValue(false),
    disponiveis: vi.fn().mockResolvedValue(new Map()),
    travarEConferir: vi.fn().mockResolvedValue(undefined),
    criarReservas: vi.fn().mockResolvedValue(opts.reservaAte ?? new Date()),
  };
  const svc = new VitrinePedidoService(
    prisma as never,
    seq as never,
    bus as never,
    notif as never,
    estoque as never,
    undefined,
    opts.checkout as never,
  );
  return { svc, prisma, bus, notif, estoque };
}

const dto = (over: Record<string, unknown> = {}) =>
  pedidoVitrineSchema.parse({
    nome: 'Maria Lojista',
    whatsapp: '(47) 99999-1234',
    cidade: 'Brusque',
    uf: 'sc',
    itens: [
      { corId: 'c1', tamanhoId: 'p', quantidade: 3 },
      { corId: 'c1', tamanhoId: 'm', quantidade: 3 },
    ],
    ...over,
  });

describe('regras puras', () => {
  it('faixa pelo total de peças', () => {
    const f = { minimoVolume: 50, minimoAtacadao: 500 };
    expect(faixaDoTotal(6, f)).toBe('entrada');
    expect(faixaDoTotal(50, f)).toBe('volume');
    expect(faixaDoTotal(500, f)).toBe('atacadao');
  });
  it('faixa melhor sem preço cai pra de baixo; nenhuma = sob consulta', () => {
    const l = { precoEntrada: D(45), precoVolume: D(41), precoAtacadao: null };
    expect(precoNaFaixa(l, 'atacadao')).toBe(41);
    expect(
      precoNaFaixa({ precoEntrada: null, precoVolume: null, precoAtacadao: null }, 'entrada'),
    ).toBe(null);
  });
  it('WhatsApp ganha o 55', () => {
    expect(normalizarWhatsapp('(47) 99999-1234')).toBe('5547999991234');
    expect(normalizarWhatsapp('5547999991234')).toBe('5547999991234');
  });
  it('isca de robô preenchida é recusada', () => {
    expect(() => dto({ site: 'http://spam' })).toThrow();
  });
});

describe('VitrinePedidoService.enviar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cria o pedido com o PREÇO DO CADASTRO, origem VITRINE, e dispara PEDIDO_CRIADO', async () => {
    const { svc, prisma, bus, notif } = montar();
    const r = await svc.enviar('atacado-ribelt', dto());

    expect(r).toEqual({
      numero: 'PED-0007',
      totalPecas: 6,
      total: 270,
      duplicado: false,
      reservaExpiraEm: null,
      pagamento: null,
    });
    const data = prisma.pedido.create.mock.calls[0][0].data;
    expect(data.origem).toBe('VITRINE');
    expect(data.status).toBe('RASCUNHO');
    expect(data.representanteId).toBeNull();
    expect(data.contatoTelefone).toBe('5547999991234');
    expect(Number(data.total)).toBe(270);
    expect(data.itens.create).toHaveLength(2);
    expect(Number(data.itens.create[0].precoUnitario)).toBe(45);
    expect(data.observacoes).toContain('Brusque/SC');
    expect(prisma.cliente.create).toHaveBeenCalled();
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'PEDIDO_CRIADO',
      expect.objectContaining({ pedidoId: 'ped-1', origem: 'VITRINE', clienteId: 'cli-novo' }),
    );
    expect(notif.criarParaRole).toHaveBeenCalled();
  });

  it('faixa Volume aplica o preço de volume a TODOS os itens', async () => {
    const { svc, prisma } = montar();
    await svc.enviar(
      'atacado-ribelt',
      dto({
        itens: [
          { corId: 'c1', tamanhoId: 'p', quantidade: 30 },
          { corId: 'c1', tamanhoId: 'm', quantidade: 20 },
        ],
      }),
    );
    const data = prisma.pedido.create.mock.calls[0][0].data;
    expect(Number(data.itens.create[0].precoUnitario)).toBe(41);
    expect(Number(data.total)).toBe(50 * 41);
  });

  it('abaixo do mínimo de peças: recusa', async () => {
    const { svc, prisma } = montar();
    await expect(
      svc.enviar(
        'atacado-ribelt',
        dto({ itens: [{ corId: 'c1', tamanhoId: 'p', quantidade: 2 }] }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('item que saiu da vitrine: recusa o pedido inteiro', async () => {
    const { svc, prisma } = montar({ variacoes: [variacao('c1', 'p', 'prod-p')] });
    await expect(svc.enviar('atacado-ribelt', dto())).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('vitrine desligada: 404 sem ler o catálogo', async () => {
    const { svc, prisma } = montar({ vitrine: { ...vitrineOk, ativa: false } });
    await expect(svc.enviar('atacado-ribelt', dto())).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.catalogoVariacao.findMany).not.toHaveBeenCalled();
  });

  it('reenvio em 10 min (mesmo telefone, total e peças) devolve o MESMO pedido', async () => {
    const { svc, prisma, bus } = montar({
      recente: {
        numero: 'PED-0006',
        itens: [{ quantidade: 3 }, { quantidade: 3 }],
        estoqueReservas: [],
      },
    });
    const r = await svc.enviar('atacado-ribelt', dto());
    expect(r).toMatchObject({ numero: 'PED-0006', duplicado: true });
    expect(prisma.pedido.create).not.toHaveBeenCalled();
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  describe('pagamento online (Asaas)', () => {
    const checkout = { tokenDoPedido: vi.fn((id: string) => `tok-${id}`) };
    const ligado = {
      ...vitrineOk,
      empresa: { ativo: true, config: { checkout: { ativo: true, taxas: { pix: {} } } } },
    };

    it('ligado: devolve o código que abre a tela de pagar', async () => {
      const { svc } = montar({ vitrine: ligado, checkout });
      const r = await svc.enviar('atacado-ribelt', dto());
      expect(r.pagamento).toEqual({ pedidoId: 'ped-1', token: 'tok-ped-1' });
    });

    it('reenvio do mesmo pedido também recebe o código (é o mesmo pedido)', async () => {
      const { svc } = montar({
        vitrine: ligado,
        checkout,
        recente: {
          id: 'ped-6',
          numero: 'PED-0006',
          itens: [{ quantidade: 6 }],
          estoqueReservas: [],
        },
      });
      const r = await svc.enviar('atacado-ribelt', dto());
      expect(r.pagamento).toEqual({ pedidoId: 'ped-6', token: 'tok-ped-6' });
    });

    it('desligado (ou sem taxas lidas): sem código — combina pelo WhatsApp', async () => {
      const semTaxas = {
        ...vitrineOk,
        empresa: { ativo: true, config: { checkout: { ativo: true } } },
      };
      expect((await montar({ checkout }).svc.enviar('atacado-ribelt', dto())).pagamento).toBeNull();
      expect(
        (await montar({ vitrine: semTaxas, checkout }).svc.enviar('atacado-ribelt', dto()))
          .pagamento,
      ).toBeNull();
    });
  });

  it('item sem preço (sob consulta) entra a R$ 0 e fica marcado na observação', async () => {
    const semPreco = { precoEntrada: null, precoVolume: null };
    const { svc, prisma } = montar({
      variacoes: [variacao('c1', 'p', 'prod-p'), variacao('c1', 'm', 'prod-m', semPreco)],
    });
    const r = await svc.enviar('atacado-ribelt', dto());
    expect(r.total).toBe(135);
    expect(prisma.pedido.create.mock.calls[0][0].data.observacoes).toContain('PREÇO A CONFIRMAR');
  });

  it('cliente que já existe pelo WhatsApp: reaproveita e só preenche o que estava vazio', async () => {
    const { svc, prisma } = montar({ clientes: [{ id: 'cli-velho', doc: '' }] });
    prisma.cliente.findUnique.mockResolvedValue({
      cnpj: null,
      telefone: '47 99999-1234',
      cidade: 'Gaspar',
      uf: null,
    });
    await svc.enviar('atacado-ribelt', dto());
    expect(prisma.cliente.create).not.toHaveBeenCalled();
    expect(prisma.cliente.update).toHaveBeenCalledWith({
      where: { id: 'cli-velho' },
      data: { uf: 'SC' },
    });
    expect(prisma.pedido.create.mock.calls[0][0].data.clienteId).toBe('cli-velho');
  });

  it('documento diferente VETA o casamento por telefone', async () => {
    const { svc, prisma } = montar({ clientes: [{ id: 'cli-outro', doc: '11111111111' }] });
    // 1ª consulta (documento) não acha; 2ª (telefone) acha outro CPF.
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'cli-outro', doc: '11111111111' }]);
    await svc.enviar('atacado-ribelt', dto({ cpfCnpj: '222.222.222-22' }));
    expect(prisma.cliente.create).toHaveBeenCalled();
  });

  it('pedido mínimo por VALOR da empresa: abaixo de R$ 600 recusa, mesmo com peças de sobra', async () => {
    const cfg = { pedidoMinimo: { tipo: 'por_valor', valorMin: 600 } };
    const { svc, prisma } = montar({
      vitrine: { ...vitrineOk, empresa: { ativo: true, config: cfg } },
    });
    // 6 peças × R$ 45 = R$ 270
    await expect(svc.enviar('atacado-ribelt', dto())).rejects.toThrow(/R\$\s?330,00/);
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('pedido mínimo por valor atingido: passa', async () => {
    const cfg = { pedidoMinimo: { tipo: 'por_valor', valorMin: 600 } };
    const { svc, prisma } = montar({
      vitrine: { ...vitrineOk, empresa: { ativo: true, config: cfg } },
    });
    await svc.enviar(
      'atacado-ribelt',
      dto({
        itens: [
          { corId: 'c1', tamanhoId: 'p', quantidade: 7 },
          { corId: 'c1', tamanhoId: 'm', quantidade: 7 },
        ],
      }),
    );
    expect(prisma.pedido.create).toHaveBeenCalled();
  });

  it('com item sob consulta o valor não é conhecido: o mínimo por valor não trava', async () => {
    const cfg = { pedidoMinimo: { tipo: 'por_valor', valorMin: 600 } };
    const { svc, prisma } = montar({
      vitrine: { ...vitrineOk, empresa: { ativo: true, config: cfg } },
      variacoes: [
        variacao('c1', 'p', 'prod-p'),
        variacao('c1', 'm', 'prod-m', { precoEntrada: null, precoVolume: null }),
      ],
    });
    await svc.enviar('atacado-ribelt', dto());
    expect(prisma.pedido.create).toHaveBeenCalled();
  });
});

describe('ERP próprio: reserva de 20 min (entrega 1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pedido criado reserva as peças e devolve até quando', async () => {
    const ate = new Date('2026-10-07T12:20:00Z');
    const { svc, estoque, bus } = montar({ reservaAte: ate });
    const r = await svc.enviar('atacado-ribelt', dto());
    expect(estoque.reservarPedido).toHaveBeenCalledWith('emp-1', 'ped-1', [
      { produtoId: 'prod-p', quantidade: 3 },
      { produtoId: 'prod-m', quantidade: 3 },
    ]);
    expect(r.reservaExpiraEm).toEqual(ate);
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'PEDIDO_CRIADO',
      expect.objectContaining({ reservaExpiraEm: ate.toISOString(), reservaMinutos: 20 }),
    );
  });

  it('reserva falhou: o pedido NÃO cai (já existe) e sai sem relógio', async () => {
    const { svc, estoque, prisma } = montar();
    estoque.reservarPedido.mockRejectedValue(new Error('banco fora'));
    const r = await svc.enviar('atacado-ribelt', dto());
    expect(prisma.pedido.create).toHaveBeenCalled();
    expect(r).toMatchObject({ numero: 'PED-0007', reservaExpiraEm: null });
  });

  it('reenvio do mesmo pedido devolve o relógio da reserva que já existe', async () => {
    const ate = new Date('2026-10-07T12:20:00Z');
    const { svc, estoque } = montar({
      recente: {
        numero: 'PED-0006',
        itens: [{ quantidade: 3 }, { quantidade: 3 }],
        estoqueReservas: [{ expiraEm: ate }],
      },
    });
    const r = await svc.enviar('atacado-ribelt', dto());
    expect(r).toMatchObject({ numero: 'PED-0006', duplicado: true, reservaExpiraEm: ate });
    expect(estoque.reservarPedido).not.toHaveBeenCalled();
  });
});

describe('pedido mínimo "50 peças OU R$ 600" (Ribelt, 06/10)', () => {
  beforeEach(() => vi.clearAllMocks());
  const cfg = { pedidoMinimo: { tipo: 'combinada', valorMin: 600, quantidadeMin: 50, modo: 'OU' } };
  const vit = { ...vitrineOk, minimoEntrada: null, empresa: { ativo: true, config: cfg } };
  const itens = (p: number, m: number) => [
    { corId: 'c1', tamanhoId: 'p', quantidade: p },
    { corId: 'c1', tamanhoId: 'm', quantidade: m },
  ];

  it('nenhum dos dois: recusa', async () => {
    const { svc, prisma } = montar({ vitrine: vit });
    await expect(svc.enviar('atacado-ribelt', dto())).rejects.toThrow(/OU/);
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('atingiu o VALOR antes das peças: passa (14 × R$ 45 = R$ 630)', async () => {
    const { svc, prisma } = montar({ vitrine: vit });
    await svc.enviar('atacado-ribelt', dto({ itens: itens(7, 7) }));
    expect(prisma.pedido.create).toHaveBeenCalled();
  });

  it('item sob consulta: o critério de 50 PEÇAS continua valendo', async () => {
    const semPreco = { precoEntrada: null, precoVolume: null };
    const { svc, prisma } = montar({
      vitrine: vit,
      variacoes: [variacao('c1', 'p', 'prod-p'), variacao('c1', 'm', 'prod-m', semPreco)],
    });
    // R$ 45 × 20 = R$ 900 em itens com preço, mas o total não é conhecido.
    await expect(svc.enviar('atacado-ribelt', dto({ itens: itens(20, 5) }))).rejects.toThrow(
      /50 un/,
    );
    await svc.enviar('atacado-ribelt', dto({ itens: itens(25, 25) }));
    expect(prisma.pedido.create).toHaveBeenCalledTimes(1);
  });
});

describe('minimoDaVitrine', () => {
  it('lê valor e quantidade; peso e sem_minimo não contam', () => {
    expect(minimoDaVitrine({ pedidoMinimo: { tipo: 'por_valor', valorMin: 600 } })).toEqual({
      valorMin: 600,
      quantidadeMin: null,
      modo: 'E',
    });
    expect(minimoDaVitrine({ pedidoMinimo: { tipo: 'por_peso', pesoMin: 250 } })).toBeNull();
    expect(minimoDaVitrine({ pedidoMinimo: { tipo: 'sem_minimo', valorMin: 600 } })).toBeNull();
    expect(minimoDaVitrine(null)).toBeNull();
  });
});

describe('vitrine que respeita estoque (entrega 5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('trava + confere + pedido + reserva na MESMA transação', async () => {
    const ate = new Date('2026-10-07T12:20:00Z');
    const { svc, estoque, prisma } = montar({ reservaAte: ate });
    estoque.vitrineRespeitaEstoque.mockResolvedValue(true);
    estoque.disponiveis.mockResolvedValue(
      new Map([
        ['prod-p', 10],
        ['prod-m', 10],
      ]),
    );
    (prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(
      (fn: (tx: unknown) => unknown) => fn(prisma),
    );
    const r = await svc.enviar('atacado-ribelt', dto());
    expect(estoque.travarEConferir).toHaveBeenCalledWith(prisma, 'emp-1', [
      { produtoId: 'prod-p', quantidade: 3 },
      { produtoId: 'prod-m', quantidade: 3 },
    ]);
    expect(estoque.criarReservas).toHaveBeenCalled();
    expect(estoque.reservarPedido).not.toHaveBeenCalled();
    expect(r.reservaExpiraEm).toEqual(ate);
  });

  it('acabou antes de mandar: recusa sem criar cliente nem pedido', async () => {
    const { svc, estoque, prisma } = montar();
    estoque.vitrineRespeitaEstoque.mockResolvedValue(true);
    estoque.disponiveis.mockResolvedValue(
      new Map([
        ['prod-p', 1],
        ['prod-m', 10],
      ]),
    );
    await expect(svc.enviar('atacado-ribelt', dto())).rejects.toThrow(/acabaram/);
    expect(prisma.cliente.create).not.toHaveBeenCalled();
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('outro cliente levou a última peça no meio: a trava recusa e nada é gravado', async () => {
    const { svc, estoque, prisma } = montar();
    estoque.vitrineRespeitaEstoque.mockResolvedValue(true);
    estoque.disponiveis.mockResolvedValue(
      new Map([
        ['prod-p', 10],
        ['prod-m', 10],
      ]),
    );
    estoque.travarEConferir.mockRejectedValue(new BusinessRuleException('Acabou o estoque de: …'));
    (prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(
      (fn: (tx: unknown) => unknown) => fn(prisma),
    );
    await expect(svc.enviar('atacado-ribelt', dto())).rejects.toThrow(/Acabou o estoque/);
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });
});
