import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: vi.fn().mockResolvedValue({ status: 200 }),
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

/**
 * DELAY em execução de TESTE não espera dias.
 *
 * A marca `_teste` já era respeitada nos nós de ENVIO, mas o DELAY não a
 * enxergava — e isso tornava metade do pós-venda intestável POR CONSTRUÇÃO: 5
 * itens da bateria pediam 2, 10 e 12 dias de espera real.
 *
 * ⚠️ O teto (não zero) é o ponto. Com zero, "agendou e o job voltou da fila" e
 * "nem passou pela fila" ficam indistinguíveis — e é essa diferença que o
 * item P3.5 (o DELAY sobrevive a restart do worker) existe pra medir.
 */
function makeService(opts: { delay: { quantidade: number; unidade: string }; teste?: boolean }) {
  const prisma = {
    fluxoExecucao: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'exec-1',
        fluxoId: 'fluxo-1',
        empresaId: 'emp-1',
        status: 'EM_EXECUCAO',
        contexto: opts.teste ? { _teste: true } : {},
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    fluxo: { findUnique: vi.fn().mockResolvedValue({ triggerTipo: 'PEDIDO_ENTREGUE' }) },
    fluxoNo: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'no-delay',
        fluxoId: 'fluxo-1',
        tipo: 'DELAY',
        acaoTipo: null,
        titulo: 'Espera',
        config: opts.delay,
      }),
    },
    fluxoEdge: {
      // O executor busca TODAS as arestas do fluxo e filtra por `sourceNoId` em
      // JS — sem ele no mock, nenhum sucessor é achado e nada é enfileirado.
      findMany: vi
        .fn()
        .mockResolvedValue([{ sourceNoId: 'no-delay', targetNoId: 'no-seguinte', label: null }]),
    },
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
    lead: { findFirst: vi.fn().mockResolvedValue(null) },
    pedido: { findFirst: vi.fn().mockResolvedValue(null) },
    cliente: { findFirst: vi.fn().mockResolvedValue(null) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const queue = { add: vi.fn().mockResolvedValue({ id: 'j' }) };
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
    queue as never,
    { criarCardsDeTarefa: vi.fn(async () => ({})) } as never,
    { suprimido: vi.fn(async () => false) } as never,
    { criar: vi.fn() } as never,
    { processarMensagemEntrante: vi.fn().mockResolvedValue({}) } as never,
  );
  return { service, queue };
}

/**
 * O delay com que o próximo passo foi enfileirado.
 *
 * As opções do BullMQ são o 3º argumento do `queue.add(nome, dados, opcoes)`;
 * procuro o argumento que TEM `delay` em vez de fixar a posição, pra o teste
 * não quebrar se a assinatura ganhar um parâmetro.
 */
const delayEnfileirado = (queue: { add: { mock: { calls: unknown[][] } } }) => {
  const chamada = queue.add.mock.calls[0] ?? [];
  const opcoes = chamada.find(
    (a): a is { delay?: number } => typeof a === 'object' && a !== null && 'delay' in a,
  );
  return opcoes?.delay;
};

const DOIS_DIAS_MS = 2 * 24 * 60 * 60 * 1000;

describe('DELAY e a marca de teste', () => {
  beforeEach(() => vi.clearAllMocks());

  it('em PRODUÇÃO o delay é o cheio — 2 dias são 2 dias', async () => {
    const { service, queue } = makeService({ delay: { quantidade: 2, unidade: 'dias' } });
    await service.executarPasso('exec-1', 'no-delay', 'job-1');
    expect(delayEnfileirado(queue)).toBe(DOIS_DIAS_MS);
  });

  // O caso que travava P3.1 (12 dias), P3.2/P3.4/P3.5 (2 dias) e a cadência do E6.
  it('em TESTE, 2 dias caem pro teto de 10s', async () => {
    const { service, queue } = makeService({
      delay: { quantidade: 2, unidade: 'dias' },
      teste: true,
    });
    await service.executarPasso('exec-1', 'no-delay', 'job-1');
    expect(delayEnfileirado(queue)).toBe(10_000);
  });

  it('em TESTE, 12 dias também — o teto é teto, não proporção', async () => {
    const { service, queue } = makeService({
      delay: { quantidade: 12, unidade: 'dias' },
      teste: true,
    });
    await service.executarPasso('exec-1', 'no-delay', 'job-1');
    expect(delayEnfileirado(queue)).toBe(10_000);
  });

  // ⚠️ O ponto do teto: NÃO é zero. Delay zero apagaria a diferença entre
  // "passou pela fila" e "nem foi enfileirado", que é o que o P3.5 mede.
  it('o delay encurtado NÃO é zero — o passo ainda passa pela fila', async () => {
    const { service, queue } = makeService({
      delay: { quantidade: 10, unidade: 'dias' },
      teste: true,
    });
    await service.executarPasso('exec-1', 'no-delay', 'job-1');
    expect(delayEnfileirado(queue)).toBeGreaterThan(0);
  });

  it('delay MENOR que o teto não é esticado', async () => {
    const { service, queue } = makeService({
      delay: { quantidade: 2, unidade: 'segundos' },
      teste: true,
    });
    await service.executarPasso('exec-1', 'no-delay', 'job-1');
    expect(delayEnfileirado(queue)).toBe(2_000);
  });

  it('config corrompida continua caindo em 0, com ou sem teste', async () => {
    const { service, queue } = makeService({
      delay: { quantidade: Number.NaN, unidade: 'dias' },
      teste: true,
    });
    await service.executarPasso('exec-1', 'no-delay', 'job-1');
    expect(delayEnfileirado(queue)).toBe(0);
  });
});
