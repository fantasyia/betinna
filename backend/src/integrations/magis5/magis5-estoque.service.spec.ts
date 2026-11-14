import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { lerConfigReservaMagis5 } from '@modules/erp/reserva-marketplace';
import { corpoSaldos, desdobrar, itensMagis5, notaEmitida, situacaoMagis5 } from './magis5-estoque';
import { Magis5EstoqueService } from './magis5-estoque.service';

// ─── Funções puras ─────────────────────────────────────────────────────────

describe('situacaoMagis5', () => {
  it('cancelado vence tudo; nota emitida ou despachado = NF; aprovado = reserva', () => {
    expect(situacaoMagis5({ status: 'canceled' }).situacao).toBe('CANCELADO');
    expect(situacaoMagis5({ status: 'canceled_resolved' }).situacao).toBe('CANCELADO');
    expect(
      situacaoMagis5({ status: 'awaiting_send', invoices: [{ status: 'authorized' }] }).situacao,
    ).toBe('NF_EMITIDA');
    expect(situacaoMagis5({ status: 'delivered' }).situacao).toBe('NF_EMITIDA');
    expect(situacaoMagis5({ status: 'approved' }).situacao).toBe('RESERVAR');
    expect(situacaoMagis5({ status: 'awaiting_invoice', invoices: [] }).situacao).toBe('RESERVAR');
    expect(situacaoMagis5({ status: 'awaiting_approval' }).situacao).toBe('AGUARDANDO_PAGAMENTO');
  });

  it('status que o código não conhece NÃO vira reserva nem baixa', () => {
    expect(situacaoMagis5({ status: 'em_separacao_novo' })).toMatchObject({
      situacao: 'DESCONHECIDO',
      status: 'em_separacao_novo',
    });
  });

  it('Full e vitrine (loja API) ficam de fora', () => {
    expect(situacaoMagis5({ status: 'approved', fulfilled: true }).situacao).toBe('IGNORAR');
    expect(
      situacaoMagis5({ status: 'approved', shipping: { logistic_type: 'fulfillment' } }).situacao,
    ).toBe('IGNORAR');
    expect(situacaoMagis5({ status: 'approved', channel: 'api-123' }).situacao).toBe('IGNORAR');
  });
});

describe('notaEmitida', () => {
  it('pendente, rejeitada ou cancelada não conta; sem status, só a chave de 44 dígitos', () => {
    expect(notaEmitida([{ status: 'pending' }, { status: 'rejected' }])).toBe(false);
    expect(notaEmitida([{ status: 'canceled', key: '1'.repeat(44) }])).toBe(false);
    expect(notaEmitida([{ status: 'sent' }])).toBe(true);
    expect(notaEmitida([{ key: '3'.repeat(44) }])).toBe(true);
    expect(notaEmitida([{ key: '123' }])).toBe(false);
    // status de nota desconhecido: segura a reserva em vez de baixar
    expect(notaEmitida([{ status: 'algo_novo', key: '3'.repeat(44) }])).toBe(false);
    expect(notaEmitida(undefined)).toBe(false);
  });
});

describe('itensMagis5 + desdobrar (kit → peças)', () => {
  const catalogo = new Map([
    ['PECA-1', { tipo: 'peca' as const, produtoId: 'p1' }],
    [
      'KIT-3',
      {
        tipo: 'kit' as const,
        componentes: [
          { produtoId: 'p1', quantidade: 2 },
          { produtoId: 'p2', quantidade: 1 },
        ],
      },
    ],
    ['KIT-ALEATORIO', { tipo: 'kitSemComposicao' as const }],
  ]);

  it('kit consome as peças da composição × quantidade vendida; SKU repetido soma', () => {
    const { itens, invalidos } = itensMagis5({
      order_items: [
        { quantity: 2, item: { seller_custom_field: 'KIT-3' } },
        { quantity: 1, item: { seller_custom_field: 'PECA-1' } },
        { quantity: 1, item: { seller_custom_field: ' PECA-1 ' } },
        { quantity: 0, item: { seller_custom_field: 'PECA-1' } },
        { quantity: 1, item: {} },
      ],
    });
    expect(invalidos).toBe(2);
    const r = desdobrar(itens, catalogo);
    expect(Object.fromEntries(r.pecas)).toEqual({ p1: 6, p2: 2 });
  });

  it('kit "Cores Aleatórias" e SKU sem par: fora da reserva, listados', () => {
    const r = desdobrar(
      new Map([
        ['KIT-ALEATORIO', 1],
        ['NAO-EXISTE', 1],
      ]),
      catalogo,
    );
    expect(r.pecas.size).toBe(0);
    expect(r.kitsSemComposicao).toEqual(['KIT-ALEATORIO']);
    expect(r.semVinculo).toEqual(['NAO-EXISTE']);
  });
});

describe('corpoSaldos', () => {
  it('formato do PUT /callbacks/stocks', () => {
    expect(corpoSaldos([{ sku: 'A', quantidade: 3 }], { id: '1', title: 'Estoque Único' })).toEqual(
      {
        stocks: [
          {
            sku: 'A',
            totalStock: 3,
            warehouses: [
              { id: '1', title: 'Estoque Único', stock: 3, consider: true, stockVirtual: 3 },
            ],
          },
        ],
      },
    );
  });
});

// ─── Service, com o ledger em memória ──────────────────────────────────────

type Linha = {
  id: string;
  empresaId: string;
  origem: string;
  pedidoNumero: string;
  produtoId: string;
  quantidade: number;
  status: string;
  movimentoId: string | null;
  motivoLiberacao: string | null;
};

const dup = () =>
  new Prisma.PrismaClientKnownRequestError('duplicado', { code: 'P2002', clientVersion: 'teste' });

function montar(opts: {
  pedidos: Array<{ numero: string; pedidoEm?: Date; dados: Record<string, unknown> }>;
  chave?: Record<string, unknown>;
  disponivel?: Record<string, number>;
  enviados?: Record<string, number>;
}) {
  const linhas: Linha[] = [];
  const movimentos: Array<{
    id: string;
    produtoId: string;
    quantidade: number;
    documento: string;
  }> = [];
  const enviados = new Map(Object.entries(opts.enviados ?? {}));
  let seq = 0;
  const casa = (l: Linha, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => {
      if (k === 'status' && v && typeof v === 'object' && 'in' in v)
        return (v as { in: string[] }).in.includes(l.status);
      return (l as Record<string, unknown>)[k] === v;
    });
  const ledger = {
    count: vi.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        linhas.filter((l) => casa(l, where)).length,
    ),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      linhas.filter((l) => casa(l, where)).map((l) => ({ ...l })),
    ),
    create: vi.fn(async ({ data }: { data: Partial<Linha> }) => {
      if (
        linhas.some(
          (l) =>
            l.empresaId === data.empresaId &&
            l.origem === data.origem &&
            l.pedidoNumero === data.pedidoNumero &&
            l.produtoId === data.produtoId,
        )
      )
        throw dup();
      const l = {
        id: `L${++seq}`,
        movimentoId: null,
        motivoLiberacao: null,
        status: 'CONFIRMADA',
        ...data,
      } as Linha;
      linhas.push(l);
      return { id: l.id };
    }),
    updateMany: vi.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Partial<Linha> }) => {
        const alvo = linhas.filter((l) => casa(l, where));
        alvo.forEach((l) => Object.assign(l, data));
        return { count: alvo.length };
      },
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Linha> }) => {
      Object.assign(linhas.find((l) => l.id === where.id)!, data);
    }),
    groupBy: vi.fn(async () => []),
  };
  const prisma = {
    estoqueReservaMarketplace: ledger,
    estoqueMovimento: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { produtoId: string; quantidade: number; documento: string };
        }) => {
          const m = { id: `M${movimentos.length + 1}`, ...data };
          movimentos.push(m);
          return { id: m.id };
        },
      ),
    },
    magis5Pedido: {
      findMany: vi.fn(async () =>
        opts.pedidos.map((p) => ({
          numero: p.numero,
          pedidoEm: p.pedidoEm ?? new Date('2026-11-20'),
          dados: p.dados,
        })),
      ),
    },
    catalogoVariacao: {
      findMany: vi.fn(async () => [
        { sku: 'PECA-1', produtoId: 'p1' },
        { sku: 'PECA-2', produtoId: 'p2' },
      ]),
    },
    catalogoKitItem: {
      findMany: vi.fn(async () => [
        {
          sku: 'KIT-2',
          composicaoOk: true,
          kit: { aleatorio: false },
          componentes: [
            { quantidade: 1, variacao: { produtoId: 'p1' } },
            { quantidade: 1, variacao: { produtoId: 'p2' } },
          ],
        },
        { sku: 'KIT-ALE', composicaoOk: false, kit: { aleatorio: true }, componentes: [] },
      ]),
    },
    magis5SaldoEnviado: {
      findMany: vi.fn(async () => [...enviados].map(([sku, quantidade]) => ({ sku, quantidade }))),
      upsert: vi.fn(
        ({ create }: { create: { sku: string; quantidade: number } }) => (
          enviados.set(create.sku, create.quantidade),
          create
        ),
      ),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.all(arg as unknown[]),
    ),
  };
  const cfg = lerConfigReservaMagis5({
    erpInterno: { ativo: true, ...(opts.chave ? { reservaMagis5: opts.chave } : {}) },
  });
  const estoque = {
    ativoNaEmpresa: vi.fn().mockResolvedValue(true),
    configReservaMagis5: vi.fn().mockResolvedValue(cfg),
    disponiveis: vi.fn(
      async (_e: string, ids: string[]) =>
        new Map(ids.map((id) => [id, opts.disponivel?.[id] ?? 0])),
    ),
  };
  const client = { put: vi.fn().mockResolvedValue({}) };
  const svc = new Magis5EstoqueService(prisma as never, estoque as never, client as never);
  return { svc, linhas, movimentos, client, enviados, estoque };
}

const LIGADA = {
  ativo: true,
  desde: '2026-11-15T00:00:00Z',
  deposito: { id: '1', title: 'Estoque Único' },
};
const pedido = (
  status: string,
  itens: Array<[string, number]>,
  extra: Record<string, unknown> = {},
) => ({
  status,
  order_items: itens.map(([sku, q]) => ({ quantity: q, item: { seller_custom_field: sku } })),
  ...extra,
});

describe('Magis5EstoqueService.reconciliar', () => {
  it('reserva o pedido sem nota (kit desdobrado) e rodar de novo não duplica', async () => {
    const m = montar({
      pedidos: [
        {
          numero: 'A1',
          dados: pedido('approved', [
            ['KIT-2', 2],
            ['PECA-1', 1],
          ]),
        },
      ],
    });
    const r1 = await m.svc.reconciliar('emp-1');
    expect(r1).toMatchObject({ acoes: 2, baixas: 0 });
    expect(m.linhas.map((l) => [l.produtoId, l.quantidade, l.status])).toEqual([
      ['p1', 3, 'CONFIRMADA'],
      ['p2', 2, 'CONFIRMADA'],
    ]);
    const r2 = await m.svc.reconciliar('emp-1');
    expect(r2?.acoes).toBe(0);
    expect(m.linhas).toHaveLength(2);
    expect(m.movimentos).toHaveLength(0);
  });

  it('nota emitida com a chave LIGADA: uma saída por peça, e só uma', async () => {
    const pedidos = [{ numero: 'A1', dados: pedido('approved', [['KIT-2', 1]]) }];
    const m = montar({ pedidos, chave: LIGADA });
    await m.svc.reconciliar('emp-1');
    pedidos[0].dados = pedido('awaiting_send', [['KIT-2', 1]], {
      invoices: [{ status: 'authorized', key: '4'.repeat(44) }],
    });
    const r = await m.svc.reconciliar('emp-1');
    expect(r?.baixas).toBe(2);
    expect(m.movimentos.map((x) => [x.produtoId, x.quantidade, x.documento])).toEqual([
      ['p1', -1, 'magis5:A1'],
      ['p2', -1, 'magis5:A1'],
    ]);
    expect(m.linhas.every((l) => l.status === 'BAIXADA' && l.movimentoId)).toBe(true);
    await m.svc.reconciliar('emp-1');
    expect(m.movimentos).toHaveLength(2);
  });

  it('nota que chegou antes da rodada (pedido depois do "desde"): baixa direto, uma vez', async () => {
    const dados = pedido('delivered', [['PECA-2', 3]]);
    const m = montar({ pedidos: [{ numero: 'B1', dados }], chave: LIGADA });
    await m.svc.reconciliar('emp-1');
    await m.svc.reconciliar('emp-1');
    expect(m.movimentos).toEqual([expect.objectContaining({ produtoId: 'p2', quantidade: -3 })]);
  });

  it('pedido anterior ao "desde", já com nota e sem reserva: não baixa (inventário já contou)', async () => {
    const m = montar({
      pedidos: [
        { numero: 'V1', pedidoEm: new Date('2026-11-01'), dados: pedido('sent', [['PECA-1', 1]]) },
      ],
      chave: LIGADA,
    });
    await m.svc.reconciliar('emp-1');
    expect(m.movimentos).toHaveLength(0);
    expect(m.linhas).toHaveLength(0);
  });

  it('cancelado antes da nota: libera a reserva, sem movimento', async () => {
    const pedidos = [{ numero: 'C1', dados: pedido('approved', [['PECA-1', 2]]) }];
    const m = montar({ pedidos, chave: LIGADA });
    await m.svc.reconciliar('emp-1');
    pedidos[0].dados = pedido('canceled', [['PECA-1', 2]]);
    await m.svc.reconciliar('emp-1');
    expect(m.linhas[0]).toMatchObject({ status: 'LIBERADA' });
    expect(m.movimentos).toHaveLength(0);
  });

  it('chave DESLIGADA: reserva anda (prévia), mas a nota NÃO gera saída', async () => {
    const pedidos = [{ numero: 'D1', dados: pedido('approved', [['PECA-1', 1]]) }];
    const m = montar({ pedidos });
    await m.svc.reconciliar('emp-1');
    expect(m.linhas[0].status).toBe('CONFIRMADA');
    pedidos[0].dados = pedido('sent', [['PECA-1', 1]]);
    await m.svc.reconciliar('emp-1');
    expect(m.movimentos).toHaveLength(0);
    expect(m.linhas[0].status).toBe('LIBERADA');
  });

  it('kit aleatório, SKU sem vínculo e status desconhecido: não mexem e aparecem no resultado', async () => {
    const m = montar({
      pedidos: [
        {
          numero: 'E1',
          dados: pedido('approved', [
            ['KIT-ALE', 1],
            ['SEM-SKU', 1],
          ]),
        },
        { numero: 'E2', dados: pedido('status_novo', [['PECA-1', 1]]) },
      ],
      chave: LIGADA,
    });
    const r = await m.svc.reconciliar('emp-1');
    expect(m.linhas).toHaveLength(0);
    expect(r).toMatchObject({
      kitsSemComposicao: ['E1:KIT-ALE'],
      semVinculo: ['E1:SEM-SKU'],
      desconhecidos: ['E2 (status_novo)'],
    });
  });

  it('empresa sem ERP: não faz nada', async () => {
    const m = montar({ pedidos: [{ numero: 'F1', dados: pedido('approved', [['PECA-1', 1]]) }] });
    m.estoque.ativoNaEmpresa.mockResolvedValue(false);
    expect(await m.svc.reconciliar('emp-1')).toBeNull();
    expect(m.linhas).toHaveLength(0);
  });
});

describe('Magis5EstoqueService.enviarSaldos', () => {
  it('chave DESLIGADA: nada vai pro Magis5', async () => {
    const m = montar({ pedidos: [], disponivel: { p1: 5 } });
    expect(await m.svc.enviarSaldos('emp-1')).toMatchObject({ enviados: 0 });
    expect(m.client.put).not.toHaveBeenCalled();
  });

  it('ligada sem depósito: não envia', async () => {
    const m = montar({ pedidos: [], chave: { ativo: true, desde: '2026-11-15T00:00:00Z' } });
    expect((await m.svc.enviarSaldos('emp-1')).motivo).toMatch(/depósito/);
    expect(m.client.put).not.toHaveBeenCalled();
  });

  it('ligada: manda o disponível (nunca negativo), só o que mudou, só peças', async () => {
    const m = montar({
      pedidos: [],
      chave: LIGADA,
      disponivel: { p1: -2, p2: 4 },
      enviados: { 'PECA-2': 4 },
    });
    expect(await m.svc.enviarSaldos('emp-1')).toEqual({ enviados: 1 });
    expect(m.client.put).toHaveBeenCalledWith(
      'emp-1',
      '/callbacks/stocks',
      corpoSaldos([{ sku: 'PECA-1', quantidade: 0 }], LIGADA.deposito),
    );
    expect(m.enviados.get('PECA-1')).toBe(0);
    // previa usa o disponível COM o pedido de marketplace descontado
    expect(m.estoque.disponiveis).toHaveBeenCalledWith('emp-1', ['p1', 'p2'], undefined, true);
    m.client.put.mockClear();
    expect(await m.svc.enviarSaldos('emp-1')).toEqual({ enviados: 0 });
    expect(m.client.put).not.toHaveBeenCalled();
  });

  it('queda em massa pra zero: para tudo e avisa', async () => {
    const m = montar({
      pedidos: [],
      chave: { ...LIGADA, limiteQueda: 1 },
      disponivel: { p1: 0, p2: 0 },
      enviados: { 'PECA-1': 3, 'PECA-2': 5 },
    });
    const r = await m.svc.enviarSaldos('emp-1');
    expect(r.enviados).toBe(0);
    expect(r.motivo).toMatch(/cairiam pra zero/);
    expect(m.client.put).not.toHaveBeenCalled();
  });
});
