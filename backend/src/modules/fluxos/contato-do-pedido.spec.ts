import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: vi.fn().mockResolvedValue({ status: 200 }),
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

/**
 * Mensagem SOBRE UM PEDIDO fala com quem FEZ aquele pedido.
 *
 * Num B2B o `Cliente` é a EMPRESA, casada por documento, e guarda UM contato.
 * Com dois compradores alternando pedidos, o cadastro fica com o do último — e
 * o rastreio do pedido do primeiro saía pro telefone do segundo. Foi medido em
 * produção com o CNPJ da Somatec.
 *
 * A cascata passa a ser lead → PEDIDO → cliente. A queda pro cliente não é
 * fallback preguiçoso: pedido anterior a 09/09 não tem contato próprio, e
 * inventar um no backfill seria gravar como fato o palpite que este campo veio
 * desfazer.
 */
function makeService(opts: {
  contexto?: Record<string, unknown>;
  pedido?: { contatoTelefone: string | null } | null;
  cliente?: { telefone: string | null } | null;
  lead?: { contatoTelefone: string | null } | null;
}) {
  const prisma = {
    fluxoExecucao: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'exec-1',
        fluxoId: 'fluxo-1',
        empresaId: 'emp-1',
        status: 'EM_EXECUCAO',
        contexto: opts.contexto ?? {},
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    fluxo: { findUnique: vi.fn().mockResolvedValue({ triggerTipo: 'PEDIDO_RASTREIO_DISPONIVEL' }) },
    fluxoNo: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'no-1',
        fluxoId: 'fluxo-1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Avisar rastreio',
        config: { destinatarioModo: 'lead', mensagem: 'seu pedido saiu' },
      }),
    },
    fluxoEdge: { findMany: vi.fn().mockResolvedValue([]) },
    fluxoExecucaoLog: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    fluxoStepClaim: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    usuario: { findFirst: vi.fn().mockResolvedValue({ id: 'rep-1', nome: 'Leandro' }) },
    lead: { findFirst: vi.fn().mockResolvedValue(opts.lead ?? null) },
    pedido: { findFirst: vi.fn().mockResolvedValue(opts.pedido ?? null) },
    cliente: { findFirst: vi.fn().mockResolvedValue(opts.cliente ?? null) },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const whatsapp = {
    enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-1' }),
    enviarMidia: vi.fn().mockResolvedValue({ externalId: 'wa-2' }),
    estaDisponivel: vi.fn().mockResolvedValue(true),
  };
  const service = new FluxoExecutorService(
    prisma as never,
    { get: vi.fn().mockReturnValue('') } as never,
    {} as never,
    whatsapp as never,
    { enviarHtmlLivre: vi.fn() } as never,
    { iniciar: vi.fn().mockResolvedValue({ aguardando: false }) } as never,
    { disparar: vi.fn() } as never,
    { aguardarSlot: vi.fn(), esperaAntesDoProativoMs: vi.fn().mockResolvedValue(0) } as never,
    { marcarDesconectado: vi.fn() } as never,
    { add: vi.fn().mockResolvedValue({ id: 'j' }) } as never,
    { criarCardsDeTarefa: vi.fn(async () => ({})) } as never,
    { suprimido: vi.fn(async () => false) } as never,
    { criar: vi.fn() } as never,
    { processarMensagemEntrante: vi.fn().mockResolvedValue({}) } as never,
  );
  return { service, prisma, whatsapp };
}

const destino = (whatsapp: { enviarTexto: { mock: { calls: unknown[][] } } }) =>
  whatsapp.enviarTexto.mock.calls[0]?.[1] as string | undefined;

describe('mensagem de pedido vai pra quem fez o pedido', () => {
  beforeEach(() => vi.clearAllMocks());

  // O caso do card: o cadastro da empresa já é do comprador B, e a mensagem é
  // sobre um pedido do comprador A.
  it('o contato do PEDIDO ganha do contato do cliente', async () => {
    const { service, whatsapp } = makeService({
      contexto: { pedidoId: 'ped-A', clienteId: 'cli-1' },
      pedido: { contatoTelefone: '5511911111111' },
      cliente: { telefone: '5511922222222' },
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(destino(whatsapp)).toBe('5511911111111@s.whatsapp.net');
  });

  it('pedido ANTIGO sem contato próprio cai no cliente — não fica sem aviso', async () => {
    const { service, whatsapp } = makeService({
      contexto: { pedidoId: 'ped-velho', clienteId: 'cli-1' },
      pedido: { contatoTelefone: null },
      cliente: { telefone: '5511922222222' },
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(destino(whatsapp)).toBe('5511922222222@s.whatsapp.net');
  });

  // O lead continua na frente: quando a execução nasceu de uma conversa, é com
  // aquela conversa que se fala — inclusive porque é a janela de 24h aberta.
  it('o lead continua ganhando do pedido', async () => {
    const { service, whatsapp } = makeService({
      contexto: { leadId: 'lead-1', pedidoId: 'ped-A', clienteId: 'cli-1' },
      lead: { contatoTelefone: '5511933333333' },
      pedido: { contatoTelefone: '5511911111111' },
      cliente: { telefone: '5511922222222' },
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(destino(whatsapp)).toBe('5511933333333@s.whatsapp.net');
  });

  it('sem pedido no contexto, nada muda pro caminho antigo', async () => {
    const { service, whatsapp, prisma } = makeService({
      contexto: { clienteId: 'cli-1' },
      cliente: { telefone: '5511922222222' },
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(destino(whatsapp)).toBe('5511922222222@s.whatsapp.net');
    // E não custa uma consulta a mais: sem `pedidoId` o pedido nem é buscado.
    expect(prisma.pedido.findFirst).not.toHaveBeenCalled();
  });
});
