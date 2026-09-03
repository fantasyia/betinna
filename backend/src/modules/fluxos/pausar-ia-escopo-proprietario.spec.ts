import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: vi.fn(),
  SsrfBlockedError: class extends Error {},
}));

/**
 * PAUSAR_IA não pode atravessar a fronteira do WhatsApp da EMPRESA pro
 * WhatsApp PESSOAL do rep (D38).
 *
 * Caso real medido em campo (X.8, 03/09): contato +55 11 94916-0673 tinha 267
 * mensagens na conversa particular do rep. Ele escreveu pro número da empresa,
 * o T1 classificou "não é lead" e pausou — e a saída do nó veio com
 * `conversasAtualizadas: 2`. O bot do rep ficou mudo na conversa privada dele,
 * sem ninguém saber por quê. Com `religar: true` é pior: um fluxo da empresa
 * LIGA o bot dentro da conversa particular.
 */
const prismaMock = () => ({
  lead: { findFirst: vi.fn().mockResolvedValue({ contatoTelefone: '+55 11 94916-0673' }) },
  conversation: {
    findFirst: vi.fn().mockResolvedValue({ id: 'conv-do-contexto' }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  $queryRaw: vi.fn().mockResolvedValue([{ id: 'conv-empresa' }]),
  $executeRaw: vi.fn().mockResolvedValue(0),
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
  const pausar = (cfg: Record<string, unknown>, ctx: Record<string, unknown>) =>
    (
      svc as unknown as {
        acaoPausarIa: (
          c: unknown,
          ctx: unknown,
          e: string,
          execId: string,
        ) => Promise<Record<string, unknown>>;
      }
    ).acaoPausarIa(cfg, ctx, 'emp-1', 'exec-1');
  /** SQL + parâmetros da chamada crua (tagged template). */
  const sql = () => {
    const [partes, ...valores] = prisma.$queryRaw.mock.calls[0] as [string[], ...unknown[]];
    return { texto: partes.join('?'), valores };
  };
  return { prisma, pausar, sql };
}

describe('PAUSAR_IA × escopo do proprietário', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fluxo da EMPRESA casa telefone SÓ nas conversas da empresa', async () => {
    const { pausar, sql } = build();

    await pausar({}, { leadId: 'lead-1' });

    const { texto, valores } = sql();
    expect(texto).toContain('"proprietarioId" IS NOT DISTINCT FROM');
    // `= NULL` não casa nada em SQL; o dono nulo é justamente o caso comum.
    expect(valores).toContain(null);
  });

  it('fluxo com DONO fica na caixa DELE — não escapa pra conversa da empresa', async () => {
    const { pausar, sql } = build();

    await pausar({}, { leadId: 'lead-1', proprietarioId: 'user-rep' });

    expect(sql().valores).toContain('user-rep');
  });

  it('com conversationId no contexto, mexe SÓ naquela conversa — nem consulta por telefone', async () => {
    const { pausar, prisma } = build();

    const r = await pausar({}, { leadId: 'lead-1', conversationId: 'conv-do-contexto' });

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['conv-do-contexto'] } }),
      }),
    );
    expect(r.conversasAtualizadas).toBe(1);
  });

  it('religar também respeita o escopo — fluxo da empresa não liga bot na conversa do rep', async () => {
    const { pausar, sql } = build();

    const r = await pausar({ religar: true }, { leadId: 'lead-1' });

    expect(sql().texto).toContain('"proprietarioId" IS NOT DISTINCT FROM');
    expect(r.botLigado).toBe(true);
  });

  it('sem telefone no lead, mas COM conversationId, a pausa acontece assim mesmo', async () => {
    // Antes exigia telefone sempre — e o telefone só serve pro match por sufixo.
    const { pausar, prisma } = build();
    prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: null });

    const r = await pausar({}, { leadId: 'lead-1', conversationId: 'conv-do-contexto' });

    expect(r.conversasAtualizadas).toBe(1);
  });
});
