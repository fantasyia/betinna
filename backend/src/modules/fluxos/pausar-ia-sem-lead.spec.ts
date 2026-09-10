import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: vi.fn().mockResolvedValue({ status: 200 }),
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

/**
 * PAUSAR_IA não precisa de LEAD — precisa de TELEFONE.
 *
 * Exigir `leadId` derrubou dois pedidos REAIS em 10/09. O P2 (rastreio
 * disponível) começa com um `Religar IA`, e o gatilho
 * `PEDIDO_RASTREIO_DISPONIVEL` traz `pedidoId` e `clienteId`, nunca `leadId`:
 * a execução morria no PRIMEIRO nó, três tentativas e fim.
 *
 * O efeito era o pior possível — pedido despachado, rastreio real no ERP, e o
 * cliente sem o código, depois de o P1 ter prometido que mandaria. O nó
 * seguinte, que sabe cair no telefone do cliente, nunca era alcançado.
 */
function makeService(opts: {
  contexto?: Record<string, unknown>;
  pedido?: { contatoTelefone: string | null } | null;
  cliente?: { telefone: string | null } | null;
  lead?: { contatoTelefone: string | null } | null;
  conversas?: Array<{ id: string }>;
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
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    fluxo: {
      findUnique: vi.fn().mockResolvedValue({ triggerTipo: 'PEDIDO_RASTREIO_DISPONIVEL' }),
    },
    fluxoNo: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'no-1',
        fluxoId: 'fluxo-1',
        tipo: 'ACAO',
        acaoTipo: 'PAUSAR_IA',
        titulo: 'Religar IA — ele pode perguntar quando chega',
        config: { religar: true },
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
    usuario: { findFirst: vi.fn().mockResolvedValue(null) },
    lead: { findFirst: vi.fn().mockResolvedValue(opts.lead ?? null) },
    pedido: { findFirst: vi.fn().mockResolvedValue(opts.pedido ?? null) },
    cliente: { findFirst: vi.fn().mockResolvedValue(opts.cliente ?? null) },
    conversation: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: opts.conversas?.length ?? 0 }),
    },
    $queryRaw: vi.fn().mockResolvedValue(opts.conversas ?? []),
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const service = new FluxoExecutorService(
    prisma as never,
    { get: vi.fn().mockReturnValue('') } as never,
    {} as never,
    { enviarTexto: vi.fn(), enviarMidia: vi.fn(), estaDisponivel: vi.fn() } as never,
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
  return { service, prisma };
}

/** O passo grava o resultado no log; é de lá que se lê o que aconteceu. */
const resultado = (prisma: { fluxoExecucaoLog: { create: { mock: { calls: unknown[][] } } } }) => {
  const chamada = prisma.fluxoExecucaoLog.create.mock.calls.at(-1)?.[0] as
    | { data?: { status?: string; erroMsg?: string; output?: Record<string, unknown> } }
    | undefined;
  return chamada?.data;
};

describe('PAUSAR_IA em contexto de PEDIDO (sem lead)', () => {
  beforeEach(() => vi.clearAllMocks());

  // O caso exato dos dois pedidos que falharam: SB2609ZHX5FD e SB2609YSFQBN.
  it('acha a conversa pelo telefone do PEDIDO, sem leadId nenhum', async () => {
    const { service, prisma } = makeService({
      contexto: { pedidoId: 'ped-1', clienteId: 'cli-1' },
      pedido: { contatoTelefone: '5511911111111' },
      conversas: [{ id: 'conv-1' }],
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(resultado(prisma)?.status).toBe('CONCLUIDO');
    expect(prisma.conversation.updateMany).toHaveBeenCalled();
  });

  it('cai no telefone do CLIENTE quando o pedido é antigo e não tem contato', async () => {
    const { service, prisma } = makeService({
      contexto: { pedidoId: 'ped-velho', clienteId: 'cli-1' },
      pedido: { contatoTelefone: null },
      cliente: { telefone: '5511922222222' },
      conversas: [{ id: 'conv-1' }],
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(resultado(prisma)?.status).toBe('CONCLUIDO');
  });

  // Sem telefone em lugar nenhum é falha de verdade — e aí o erro tem que dizer
  // isso, não "leadId ausente", que mandava procurar no lugar errado.
  it('falha quando NENHUMA fonte tem telefone', async () => {
    const { service, prisma } = makeService({
      contexto: { clienteId: 'cli-1' },
      cliente: { telefone: null },
    });

    await expect(service.executarPasso('exec-1', 'no-1', 'job-1')).rejects.toThrow(
      /sem telefone — nem lead, nem pedido, nem cliente/,
    );
    expect(resultado(prisma)?.status).toBe('FALHOU');
  });

  it('o caminho com lead continua igual', async () => {
    const { service, prisma } = makeService({
      contexto: { leadId: 'lead-1' },
      lead: { contatoTelefone: '5511933333333' },
      conversas: [{ id: 'conv-1' }],
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(resultado(prisma)?.status).toBe('CONCLUIDO');
  });
});
