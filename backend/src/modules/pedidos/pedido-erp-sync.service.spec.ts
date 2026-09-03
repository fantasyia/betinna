import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PedidoErpSyncService, linkPublicoRastreio } from './pedido-erp-sync.service';

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
        numeroSite: opts.numeroSite ?? null,
        total: 100,
        clienteId: 'cli-1',
        representanteId: null,
        rastreioCodigo: opts.rastreioGravado ?? 'BR123456789BR',
        rastreioUrl: 'https://rastreio/BR123456789BR',
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
    // Ponte vendedor→contato: por padrão não acha (os casos por contato passam
    // o contato dentro do próprio pedido).
    { acharContatoDoVendedor: vi.fn().mockResolvedValue(null) } as never,
    // Aviso pro site: best-effort e sem site configurado nos testes.
    { notificar: vi.fn().mockResolvedValue(false), configurado: false } as never,
    notificacoes as never,
    bus as never,
  );
  return { svc, prisma, tiny, notificacoes, bus, sequence };
}

/** A janela padrão é de 30 dias — o pedido base é de hoje pra não vencer. */
const HOJE = new Date().toISOString().slice(0, 10);

const PEDIDO_ERP = {
  id: 900,
  numeroPedido: 55,
  situacao: 3, // aprovada
  data: HOJE,
  valorTotalPedido: 3150,
  valorTotalProdutos: 3150,
  cliente: { id: 4242, nome: 'Indústria Alfa', cpfCnpj: '12.345.678/0001-90' },
  vendedor: { id: 7, nome: 'Marcelo Harada' },
  itens: [{ produto: { id: 1, sku: 'MB-01' }, quantidade: 2, valorUnitario: 1575 }],
};

describe('pedidos que vêm do ERP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('importa pedido novo com a DATA DO ERP (e não com o relógio de agora)', async () => {
    // Importar tudo com a data de hoje jogaria venda de julho pro fechamento
    // de agosto — o fechamento de comissão fecha por período.
    const { svc, prisma } = build({ detalhe: PEDIDO_ERP });

    const r = await svc.sincronizar('emp-1');

    expect(r.criados).toBe(1);
    const dados = prisma.pedido.create.mock.calls[0][0].data;
    expect(dados.numeroErp).toBe('55');
    expect(dados.origem).toBe('ERP');
    expect(dados.status).toBe('ENVIADO_ERP');
    expect((dados.criadoEm as Date).toISOString()).toContain(HOJE);
    expect(Number(dados.total)).toBe(3150);
  });

  it('sem vendedor casado, o pedido entra SEM representante (e avisa)', async () => {
    // Chutar o dono mexeria na comissão de duas pessoas.
    const { svc, prisma } = build({ detalhe: PEDIDO_ERP, usuarios: [{ id: 'u1', nome: 'Outro' }] });

    const r = await svc.sincronizar('emp-1');

    expect(prisma.pedido.create.mock.calls[0][0].data.representanteId).toBeNull();
    expect(r.avisos.join(' ')).toContain('Marcelo Harada');
  });

  it('casa pelo CONTATO do vendedor antes do nome', async () => {
    // Bug real de produção (29/08): o vendedor "REP TESTE" não casou com o
    // usuário "TESTE · Automação" e o pedido entrou sem dono — comissão sem
    // destinatário. O contato é o id que os dois lados conhecem.
    const { svc, prisma } = build({
      detalhe: {
        ...PEDIDO_ERP,
        vendedor: { id: 7, nome: 'REP TESTE', contato: { id: 894882031 } },
      },
      usuarios: [
        { id: 'rep-9', nome: 'TESTE · Automação', contatoErpId: '894882031' },
        { id: 'rep-1', nome: 'Outro', contatoErpId: null },
      ],
    });

    await svc.sincronizar('emp-1');

    expect(prisma.pedido.create.mock.calls[0][0].data.representanteId).toBe('rep-9');
    // Com dono, a venda é POR REPRESENTANTE — e é a origem que define os 6%
    // da comissão de originação (contra 12% do canal).
    expect(prisma.pedido.create.mock.calls[0][0].data.origem).toBe('REP_APP');
  });

  it('pedido órfão ADOTA o dono quando o cadastro é arrumado depois', async () => {
    // Sem isto, arrumar o vendedor no ERP (ou vincular o contato) não trazia
    // dono nenhum pro pedido que já tinha entrado — e a comissão daquela venda
    // simplesmente não existia.
    const { svc, prisma } = build({
      detalhe: {
        ...PEDIDO_ERP,
        vendedor: { id: 7, nome: 'REP TESTE', contato: { id: 894882031 } },
      },
      pedidoExistente: {
        id: 'ped-1',
        numero: 'PED-0005',
        status: 'ENVIADO_ERP',
        observacoes: null,
        total: 3150,
        rastreioCodigo: null,
        rastreioUrl: null,
        representanteId: null,
      },
      usuarios: [{ id: 'rep-9', nome: 'Quem seja', contatoErpId: '894882031' }],
    });

    await svc.sincronizar('emp-1');

    const adocao = prisma.pedido.update.mock.calls.find(
      (c) => (c[0] as { data: { representanteId?: string } }).data.representanteId,
    );
    expect(adocao).toBeDefined();
    expect((adocao?.[0] as { data: { representanteId: string } }).data.representanteId).toBe(
      'rep-9',
    );
  });

  it('pedido que JÁ tem dono não troca de dono', async () => {
    // Trocar o dono é mexer na comissão de duas pessoas.
    const { svc, prisma } = build({
      detalhe: {
        ...PEDIDO_ERP,
        vendedor: { id: 7, nome: 'REP TESTE', contato: { id: 894882031 } },
      },
      pedidoExistente: {
        id: 'ped-1',
        numero: 'PED-0005',
        status: 'ENVIADO_ERP',
        observacoes: null,
        total: 3150,
        rastreioCodigo: null,
        rastreioUrl: null,
        representanteId: 'rep-antigo',
      },
      usuarios: [{ id: 'rep-9', nome: 'Quem seja', contatoErpId: '894882031' }],
    });

    await svc.sincronizar('emp-1');

    const trocou = prisma.pedido.update.mock.calls.some(
      (c) => (c[0] as { data: { representanteId?: string } }).data.representanteId,
    );
    expect(trocou).toBe(false);
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

  it('pedido que o filtro de data NÃO acha ainda assim entra', async () => {
    // O furo real, visto em produção: a listagem do Tiny devolve `dataCriacao`
    // vazia, e pedido sem data não casa com filtro de data nenhum. Como a
    // passada com filtro trazia OUTROS pedidos, o buraco ficava invisível — a
    // tela dizia "sincronizado" e faltava um.
    const { svc, tiny, prisma } = build({ detalhe: PEDIDO_ERP });
    tiny.listar = vi.fn(async (_e: string, f: { dataInicial?: string }) =>
      f.dataInicial
        ? { itens: [{ id: 901, numeroPedido: 56 }], total: 1 } // o que TEM data
        : { itens: [{ id: 900, numeroPedido: 55, dataCriacao: '' }], total: 1 },
    );

    await svc.sincronizar('emp-1');

    // Os dois foram olhados: o do filtro e o que só a passada sem filtro viu.
    const olhados = tiny.obter.mock.calls.map((c: unknown[]) => c[1]);
    expect(olhados).toContain(900);
    expect(olhados).toContain(901);
    expect(prisma.pedido.create).toHaveBeenCalled();
  });

  it('pedido que já chega CANCELADO não nasce aqui', async () => {
    // Ruído histórico do ERP. E tem um efeito prático: sem isto, apagar um
    // pedido de teste no app não adianta — o sync seguinte traz de volta.
    const { svc, prisma } = build({ detalhe: { ...PEDIDO_ERP, situacao: 2 } });

    const r = await svc.sincronizar('emp-1');

    expect(prisma.pedido.create).not.toHaveBeenCalled();
    expect(r.criados).toBe(0);
  });

  it('mas o pedido que EXISTE aqui vira CANCELADO quando o ERP cancela', async () => {
    const { svc, prisma } = build({
      detalhe: { ...PEDIDO_ERP, situacao: 2 },
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

    await svc.sincronizar('emp-1');

    expect(prisma.pedido.update.mock.calls[0][0].data.status).toBe('CANCELADO');
  });

  it('sincronizarUm (webhook) devolve o motivo certo pro pedido já cancelado', async () => {
    // Motivo errado em log engana quem for investigar: "fora da janela" e "já
    // veio cancelado" são fatos diferentes.
    const { svc } = build({ detalhe: { ...PEDIDO_ERP, situacao: 2 } });

    await expect(svc.sincronizarUm('emp-1', 900)).resolves.toBe('jaCancelado');
  });

  it('pedido velho demais é visto e NÃO entra (quem corta é o detalhe)', async () => {
    const { svc, prisma } = build({ detalhe: { ...PEDIDO_ERP, data: '2020-01-01' } });

    const r = await svc.sincronizar('emp-1', { dias: 30 });

    expect(prisma.pedido.create).not.toHaveBeenCalled();
    expect(r.foraDaJanela).toBe(1);
  });

  it('pedido SEM data nenhuma entra — sumir em silêncio é pior', async () => {
    const semData = { ...PEDIDO_ERP, data: undefined, dataCriacao: undefined };
    const { svc, prisma } = build({ detalhe: semData });

    await svc.sincronizar('emp-1');

    expect(prisma.pedido.create).toHaveBeenCalled();
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

  /**
   * O rastreio aparece no DESPACHO, dias antes da entrega.
   *
   * O único evento que existia neste caminho era o de ENTREGUE — então um fluxo
   * pendurado nele mandaria o código de rastreio DEPOIS de a encomenda ter
   * chegado na casa da pessoa. O gatilho novo dispara na transição
   * vazio → preenchido, que é a condição real de "o rastreio existe".
   */
  describe('gatilho de rastreio disponível', () => {
    const COM_RASTREIO = {
      ...PEDIDO_ERP,
      situacao: 5,
      transportador: {
        codigoRastreamento: 'BR123456789BR',
        urlRastreamento: 'https://rastreio/BR123456789BR',
      },
    };
    const semRastreio = {
      id: 'ped-1',
      numero: 'PED-0007',
      status: 'EM_SEPARACAO',
      observacoes: null,
      total: 3150,
      rastreioCodigo: null,
      rastreioUrl: null,
    };

    it('dispara quando o rastreio passa a existir', async () => {
      const { svc, bus } = build({ detalhe: COM_RASTREIO, pedidoExistente: semRastreio });

      await svc.sincronizar('emp-1');

      const evento = bus.disparar.mock.calls.find((c) => c[1] === 'PEDIDO_RASTREIO_DISPONIVEL');
      expect(evento).toBeDefined();
    });

    it('leva o CÓDIGO e a URL no payload — o nó de WhatsApp interpola do contexto, não vai ao banco', async () => {
      const { svc, bus } = build({ detalhe: COM_RASTREIO, pedidoExistente: semRastreio });

      await svc.sincronizar('emp-1');

      const evento = bus.disparar.mock.calls.find((c) => c[1] === 'PEDIDO_RASTREIO_DISPONIVEL');
      expect(evento![2]).toMatchObject({
        rastreioCodigo: 'BR123456789BR',
        rastreioUrl: 'https://rastreio/BR123456789BR',
      });
    });

    it('usa o número do SITE quando existe — o cliente não conhece o PED-…', async () => {
      const { svc, bus } = build({
        detalhe: COM_RASTREIO,
        pedidoExistente: semRastreio,
        numeroSite: 'SB2608ABCDEF',
      });

      await svc.sincronizar('emp-1');

      const evento = bus.disparar.mock.calls.find((c) => c[1] === 'PEDIDO_RASTREIO_DISPONIVEL');
      expect((evento![2] as { pedido: { numero: string } }).pedido.numero).toBe('SB2608ABCDEF');
    });

    it('NÃO reemite quando o rastreio já estava gravado — a varredura roda todo dia', async () => {
      // Sem esta guarda, o cliente receberia o mesmo código a cada rodada.
      const { svc, bus } = build({
        detalhe: COM_RASTREIO,
        pedidoExistente: {
          ...semRastreio,
          status: 'ENVIADO',
          rastreioCodigo: 'BR123456789BR',
          rastreioUrl: 'https://rastreio/BR123456789BR',
        },
      });

      await svc.sincronizar('emp-1');

      expect(
        bus.disparar.mock.calls.filter((c) => c[1] === 'PEDIDO_RASTREIO_DISPONIVEL'),
      ).toHaveLength(0);
    });

    it('pedido sem rastreio nenhum não dispara', async () => {
      const { svc, bus } = build({
        detalhe: { ...PEDIDO_ERP, situacao: 5 },
        pedidoExistente: semRastreio,
      });

      await svc.sincronizar('emp-1');

      expect(
        bus.disparar.mock.calls.filter((c) => c[1] === 'PEDIDO_RASTREIO_DISPONIVEL'),
      ).toHaveLength(0);
    });
  });

  describe('linkPublicoRastreio', () => {
    // O `urlRastreamento` do Tiny vem vazio na maioria dos envios; sem isto a
    // mensagem de despacho sai com o código e sem lugar nenhum pra clicar.
    it('monta o link público quando o envio é Olist Envios (Melhor Envio por baixo)', () => {
      expect(linkPublicoRastreio('XX999888777BR', { nome: 'Olist Envios' })).toBe(
        'https://www.melhorrastreio.com.br/rastreio/XX999888777BR',
      );
    });

    it('monta pelo formato do código, mesmo sem saber a forma de envio', () => {
      expect(linkPublicoRastreio('AA123456789BR')).toContain('melhorrastreio.com.br');
    });

    it('transportadora própria com código fora do padrão NÃO ganha link', () => {
      // Link que abre em "não encontrado" é pior que mensagem sem link.
      expect(linkPublicoRastreio('NF-2026-0001', { nome: 'Transportadora Fulano' })).toBeNull();
    });

    it('sem código não há link', () => {
      expect(linkPublicoRastreio(null, { nome: 'Olist Envios' })).toBeNull();
    });
  });
});
