import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: vi.fn(),
  SsrfBlockedError: class extends Error {},
}));

/**
 * PAUSAR_IA precisa PARAR o bot, não só impedir o próximo turno.
 *
 * O caso real (regressão do T1.11, 26/08): o RT pausou às 21:15:56 e o C1 —
 * que já estava DENTRO da chamada ao modelo — voltou às 21:16:11, 14s depois,
 * mandou mensagem na conversa pausada e criou uma segunda tarefa pro mesmo
 * recado. Reordenar os nós não resolve: a janela é a duração da chamada à IA,
 * que vai de 10 a 90 segundos.
 */
const prismaMock = () => ({
  lead: { findFirst: vi.fn().mockResolvedValue({ contatoTelefone: '+55 19 99999-8877' }) },
  conversation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  $queryRaw: vi.fn().mockResolvedValue([{ id: 'conv-1' }]),
  $executeRaw: vi.fn().mockResolvedValue(2),
});

function build() {
  const prisma = prismaMock();
  const svc = new FluxoExecutorService(
    prisma as never,
    { get: () => 'test', isProduction: false } as never,
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
    {} as never,
  );
  const pausar = (cfg: Record<string, unknown>) =>
    (
      svc as unknown as {
        acaoPausarIa: (
          c: unknown,
          ctx: unknown,
          e: string,
          execId: string,
        ) => Promise<Record<string, unknown>>;
      }
    ).acaoPausarIa(cfg, { leadId: 'lead-1' }, 'emp-1', 'exec-rt');
  return { svc, prisma, pausar };
}

describe('PAUSAR_IA × execução de IA em voo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pausar CANCELA as execuções vivas do lead', async () => {
    const { prisma, pausar } = build();

    const r = await pausar({});

    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(r.canceladas).toBe(2);
    expect(r.botLigado).toBe(false);
  });

  it('NÃO cancela a própria execução — senão o resto do ramo não roda', async () => {
    // É a armadilha da correção: cancelar tudo do lead mataria o próprio fluxo
    // no meio, e a tarefa que vem DEPOIS da pausa nunca seria criada.
    const { prisma, pausar } = build();

    await pausar({});

    const sql = prisma.$executeRaw.mock.calls[0].flat().join(' ');
    expect(sql).toContain('id <> ');
    const params = prisma.$executeRaw.mock.calls[0].slice(1);
    expect(params).toContain('exec-rt');
  });

  it('RELIGAR não cancela nada — só devolve o controle ao bot', async () => {
    const { prisma, pausar } = build();

    const r = await pausar({ religar: true });

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(r.canceladas).toBe(0);
    expect(r.botLigado).toBe(true);
  });

  it('falha ao cancelar não derruba a pausa — o efeito principal é pausar', async () => {
    const { prisma, pausar } = build();
    prisma.$executeRaw.mockRejectedValue(new Error('banco fora'));

    const r = await pausar({});

    expect(r.botLigado).toBe(false);
    expect(r.canceladas).toBe(0);
    expect(prisma.conversation.updateMany).toHaveBeenCalled();
  });
});
