import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversarIaService } from './conversar-ia.service';

/**
 * O deploy que engole o turno.
 *
 * Medido em produção em 04/09: o backend "reiniciava" a cada ~16 min — eram
 * pushes no `main`, cada um virando redeploy. O turno de IA roda dentro do
 * processo (webhook → Inbox → `retomar` em fire-and-forget), e o Railway manda
 * SIGKILL logo atrás do SIGTERM. O turno morria no `await` da OpenAI: sem erro,
 * sem `finally` (lock preso), mensagem do cliente perdida.
 *
 * Estes testes prendem o drain: o `onModuleDestroy` não devolve enquanto houver
 * turno em voo — e devolve assim que o último termina.
 */
function build() {
  const prisma = {
    fluxoExecucao: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    message: { findMany: vi.fn().mockResolvedValue([]) },
    conversation: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const svc = new ConversarIaService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  for (const nivel of ['log', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(
      (svc as unknown as { logger: Record<string, () => void> }).logger,
      nivel,
    ).mockImplementation(() => undefined);
  }
  return { svc, prisma };
}

const EXEC = {
  id: 'exec-1',
  status: 'AGUARDANDO',
  aguardandoNoId: 'no-ia',
  empresaId: 'emp-1',
  contexto: { leadId: 'lead-1', conversationId: 'conv-1' },
  processandoTurno: false,
  turnoIniciadoEm: null,
};

/** Promise cuja resolução a gente controla — simula a OpenAI demorando. */
function segurar<T = void>() {
  let soltar!: (v: T) => void;
  const p = new Promise<T>((r) => (soltar = r));
  return { p, soltar };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('drain no shutdown — turno em voo não morre com o processo', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('sem turno em voo, o encerramento não espera nada', async () => {
    const { svc } = build();
    const antes = Date.now();
    await svc.onModuleDestroy();
    expect(Date.now() - antes).toBeLessThan(50);
  });

  it('o encerramento SEGURA até o turno acabar — e aí solta, com o lock liberado', async () => {
    const { svc, prisma } = build();
    prisma.fluxoExecucao.findUnique.mockResolvedValue(EXEC);
    const openai = segurar();
    vi.spyOn(svc as never, 'processarTurno' as never).mockImplementation((() => openai.p) as never);

    // Exatamente como a Inbox chama: ninguém espera pelo retomar.
    void svc.retomar('exec-1', 'conv-1', 'quero um orçamento');
    await tick(); // deixa o claim acontecer

    let encerrou = false;
    const drain = svc.onModuleDestroy().then(() => {
      encerrou = true;
    });
    await tick();
    await tick();
    // Turno ainda rodando → o processo NÃO pode ir embora.
    expect(encerrou).toBe(false);

    openai.soltar();
    await drain;
    expect(encerrou).toBe(true);
    // O `finally` do turno rodou: o lock foi solto antes do processo morrer.
    const soltouLock = prisma.fluxoExecucao.updateMany.mock.calls.some(
      (c) => (c[0] as { data?: { processandoTurno?: boolean } }).data?.processandoTurno === false,
    );
    expect(soltouLock).toBe(true);
  });

  it('turno que NÃO termina no prazo: o drain estoura e deixa o processo ir (o reaper recupera)', async () => {
    vi.useFakeTimers();
    const { svc, prisma } = build();
    prisma.fluxoExecucao.findUnique.mockResolvedValue(EXEC);
    // Nunca resolve — o pior caso.
    vi.spyOn(svc as never, 'processarTurno' as never).mockImplementation(
      (() => new Promise(() => undefined)) as never,
    );
    void svc.retomar('exec-1', 'conv-1', 'oi');
    await vi.advanceTimersByTimeAsync(0);

    let encerrou = false;
    const drain = svc.onModuleDestroy().then(() => {
      encerrou = true;
    });
    await vi.advanceTimersByTimeAsync(24_000);
    expect(encerrou).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await drain;
    expect(encerrou).toBe(true);
  });
});
