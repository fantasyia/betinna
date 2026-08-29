import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PedidoErpSyncService } from './pedido-erp-sync.service';

/**
 * O caminho de VOLTA do ERP: o que nasce ou muda no Tiny precisa aparecer aqui.
 *
 * O que estes testes protegem é justamente o que dá errado em silêncio —
 * pedido importado com a data de hoje (bagunça o fechamento), pedido atribuído
 * ao rep errado (mexe em comissão), entrega falhada virando status calado.
 */
function build(
  opts: {
    detalhe?: Record<string, unknown>;
    pedidoExistente?: Record<string, unknown> | null;
    clienteExistente?: { id: string } | null;
    usuarios?: Array<{ id: string; nome: string }>;
    produto?: { id: string } | null;
    pendentes?: Array<{ numeroErp: string }>;
  } = {},
) {
  const detalhe = opts.detalhe ?? {};
  const tiny = {
    listar: vi.fn().mockResolvedValue({ itens: [{ id: 900, numeroPedido: 55 }], total: 1 }),
    obter: vi.fn().mockResolvedValue(detalhe),
  };
  const prisma = {
    pedido: {
      findFirst: vi.fn().mockResolvedValue(opts.pedidoExistente ?? null),
      findMany: vi.fn().mockResolvedValue(opts.pendentes ?? []),
      findUnique: vi.fn().mockResolvedValue({
        id: 'ped-1',
        numero: 'PED-0007',
        total: 100,
        clienteId: 'cli-1',
        representanteId: null,
        cliente: { id: 'cli-1', nome: 'Cliente X' },
      }),
      create: vi.fn().mockResolvedValue({ id: 'ped-novo', numero: 'PED-0009' }),
      update: vi.fn().mockResolvedValue({}),
    },
    cliente: {
      findFirst: vi.fn().mockResolvedValue(opts.clienteExistente ?? null),
      create: vi.fn().mockResolvedValue({ id: 'cli-novo' }),
      update: vi.fn().mockResolvedValue({}),
    },
    // Cuidado com ?? aqui: o teste do SKU desconhecido passa null de propósito.
    produto: {
      findFirst: vi.fn().mockResolvedValue('produto' in opts ? opts.produto : { id: 'prod-1' }),
    },
    usuario: {
      findMany: vi.fn().mockResolvedValue(opts.usuarios ?? []),
      findUnique: vi.fn().mockResolvedValue({ comissaoPadrao: 5 }),
    },
  };
  const integracoes = {
    gravarCursorRecurso: vi.fn().mockResolvedValue(undefined),
    registrarSaudeOk: vi.fn().mockResolvedValue(undefined),
  };
  const sequence = { next: vi.fn().mockResolvedValue(9) };
  const notificacoes = { criarParaRole: vi.fn().mockResolvedValue(1) };
  const bus = { disparar: vi.fn().mockResolvedValue(undefined) };

  const svc = new PedidoErpSyncService(
    prisma as never,
    tiny as never,
    integracoes as never,
    sequence as never,
    notificacoes as never,
    bus as never,
  );
  return { svc, prisma, tiny, notificacoes, bus, sequence };
}

const PEDIDO_ERP = {
  id: 900,
  numeroPedido: 55,
  situacao: 3, // aprovada
  data: '2026-07-15',
  valorTotalPedido: 3150,
  valorTotalProdutos: 3150,
  cliente: { id: 4242, nome: 'Indústria Alfa', cpfCnpj: '12.345.678/0001-90' },
  vendedor: { id: 7, nome: 'Marcelo Harada' },
  itens: [{ produto: { id: 1, sku: 'MB-01' }, quantidade: 2, valorUnitario: 1575 }],
};

describe('pedidos que vêm do ERP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('importa pedido novo com a DATA DO ERP, não a de hoje', async () => {
    // Importar com a data de agora jogaria venda de julho pro fechamento de agosto.
    const { svc, prisma } = build({ detalhe: PEDIDO_ERP });

    const r = await svc.sincronizar('emp-1');

    expect(r.criados).toBe(1);
    const dados = prisma.pedido.create.mock.calls[0][0].data;
    expect(dados.numeroErp).toBe('55');
    expect(dados.origem).toBe('ERP');
    expect(dados.status).toBe('ENVIADO_ERP');
    expect((dados.criadoEm as Date).toISOString()).toContain('2026-07-15');
    expect(Number(dados.total)).toBe(3150);
  });

  it('sem vendedor casado, o pedido entra SEM representante (e avisa)', async () => {
    // Chutar o dono mexeria na comissão de duas pessoas.
    const { svc, prisma } = build({ detalhe: PEDIDO_ERP, usuarios: [{ id: 'u1', nome: 'Outro' }] });

    const r = await svc.sincronizar('emp-1');

    expect(prisma.pedido.create.mock.calls[0][0].data.representanteId).toBeNull();
    expect(r.avisos.join(' ')).toContain('Marcelo Harada');
  });

  it('vendedor casa por nome mesmo com acento/caixa diferentes', async () => {
    const { svc, prisma } = build({
      detalhe: PEDIDO_ERP,
      usuarios: [{ id: 'u-rep', nome: 'marcelo haráda' }],
    });

    await svc.sincronizar('emp-1');

    expect(prisma.pedido.create.mock.calls[0][0].data.representanteId).toBe('u-rep');
  });

  it('dois usuários com o mesmo nome → ninguém leva o pedido', async () => {
    const { svc, prisma } = build({
      detalhe: PEDIDO_ERP,
      usuarios: [
        { id: 'u1', nome: 'Marcelo Harada' },
        { id: 'u2', nome: 'Marcelo Harada' },
      ],
    });

    await svc.sincronizar('emp-1');

    expect(prisma.pedido.create.mock.calls[0][0].data.representanteId).toBeNull();
  });

  it('SKU desconhecido não derruba o pedido — entra sem o item, com aviso', async () => {
    const { svc, prisma } = build({ detalhe: PEDIDO_ERP, produto: null });

    const r = await svc.sincronizar('emp-1');

    expect(prisma.pedido.create).toHaveBeenCalled();
    expect(r.avisos.join(' ')).toContain('MB-01');
  });

  it('pedido que já existe aqui tem status e rastreio atualizados', async () => {
    const { svc, prisma } = build({
      detalhe: {
        ...PEDIDO_ERP,
        situacao: 5, // enviada
        transportador: { codigoRastreamento: 'BR123', urlRastreamento: 'https://rastreio/BR123' },
      },
      pedidoExistente: {
        id: 'ped-1',
        numero: 'PED-0007',
        status: 'ENVIADO_ERP',
        observacoes: null,
        total: 3150,
        rastreioCodigo: null,
        rastreioUrl: null,
      },
    });

    const r = await svc.sincronizar('emp-1');

    expect(r.atualizados).toBe(1);
    expect(prisma.pedido.create).not.toHaveBeenCalled();
    const dados = prisma.pedido.update.mock.calls[0][0].data;
    expect(dados.status).toBe('ENVIADO');
    expect(dados.rastreioCodigo).toBe('BR123');
  });

  it('nada mudou no ERP → nenhuma escrita no banco', async () => {
    const { svc, prisma } = build({
      detalhe: PEDIDO_ERP,
      pedidoExistente: {
        id: 'ped-1',
        numero: 'PED-0007',
        status: 'ENVIADO_ERP',
        observacoes: null,
        total: 3150,
        rastreioCodigo: null,
        rastreioUrl: null,
      },
    });

    const r = await svc.sincronizar('emp-1');

    expect(r.semMudanca).toBe(1);
    expect(prisma.pedido.update).not.toHaveBeenCalled();
  });

  it('entrega confirmada no ERP dispara o gatilho PEDIDO_ENTREGUE uma vez', async () => {
    const { svc, bus } = build({
      detalhe: { ...PEDIDO_ERP, situacao: 6 },
      pedidoExistente: {
        id: 'ped-1',
        numero: 'PED-0007',
        status: 'ENVIADO',
        observacoes: null,
        total: 3150,
        rastreioCodigo: null,
        rastreioUrl: null,
      },
    });

    await svc.sincronizar('emp-1');

    expect(bus.disparar).toHaveBeenCalledTimes(1);
    expect(bus.disparar.mock.calls[0][1]).toBe('PEDIDO_ENTREGUE');
  });

  it('"não entregue" (9) notifica e carimba — mas só na primeira vez', async () => {
    // O ERP responde 9 todo dia até alguém resolver; avisar todo dia é o mesmo
    // que não avisar.
    const base = {
      id: 'ped-1',
      numero: 'PED-0007',
      status: 'ENVIADO',
      total: 3150,
      rastreioCodigo: null,
      rastreioUrl: null,
    };
    const primeira = build({
      detalhe: { ...PEDIDO_ERP, situacao: 9 },
      pedidoExistente: { ...base, observacoes: null },
    });
    await primeira.svc.sincronizar('emp-1');
    expect(primeira.notificacoes.criarParaRole).toHaveBeenCalledTimes(1);

    const segunda = build({
      detalhe: { ...PEDIDO_ERP, situacao: 9 },
      pedidoExistente: { ...base, observacoes: '[ERP] entrega não realizada — 15/07/2026.' },
    });
    await segunda.svc.sincronizar('emp-1');
    expect(segunda.notificacoes.criarParaRole).not.toHaveBeenCalled();
  });

  it('filtro de data vazio → refaz sem filtro e corta a janela aqui', async () => {
    // O modo de falha real: o ERP devolve lista VAZIA pro filtro de data, com
    // pedido recente sentado lá. Sem plano B, "0 novos" parece resposta certa.
    const { svc, tiny, prisma } = build({ detalhe: PEDIDO_ERP });
    const hoje = new Date().toISOString().slice(0, 10);
    tiny.listar = vi.fn(async (_e: string, f: { dataInicial?: string }) =>
      f.dataInicial
        ? { itens: [], total: 0 }
        : { itens: [{ id: 900, numeroPedido: 55, dataCriacao: hoje }], total: 1 },
    );

    const r = await svc.sincronizar('emp-1');

    expect(prisma.pedido.create).toHaveBeenCalled();
    expect(r.avisos.join(' ')).toContain('filtro de data');
  });

  it('no plano B, pedido FORA da janela não entra', async () => {
    const { svc, tiny, prisma } = build({ detalhe: PEDIDO_ERP });
    tiny.listar = vi.fn(async (_e: string, f: { dataInicial?: string }) =>
      f.dataInicial
        ? { itens: [], total: 0 }
        : { itens: [{ id: 900, numeroPedido: 55, dataCriacao: '2020-01-01' }], total: 1 },
    );

    const r = await svc.sincronizar('emp-1', { dias: 30 });

    expect(prisma.pedido.create).not.toHaveBeenCalled();
    expect(r.lidos).toBe(0);
  });

  it('confere por número os pedidos abertos que ficaram fora da janela', async () => {
    // Sem esta rede, pedido antigo entregue hoje ficaria "Enviado" pra sempre.
    const { svc, tiny } = build({
      detalhe: PEDIDO_ERP,
      pendentes: [{ numeroErp: '55' }],
    });

    await svc.sincronizar('emp-1', { dias: 7 });

    expect(tiny.listar).toHaveBeenCalledWith('emp-1', { numero: '55', limit: 5 });
  });
});
