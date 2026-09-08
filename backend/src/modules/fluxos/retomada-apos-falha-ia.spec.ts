import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversarIaService } from './conversar-ia.service';
import { FluxoTriggersJob } from './fluxo-triggers.job';

/**
 * Depois que a IA cai, a conversa TEM que voltar sozinha.
 *
 * A regra é do Léo (08/09): silêncio no momento da queda — "esse tipo de
 * cliente não vai esfriar por alguns minutos" —, **contanto que quando voltar,
 * volte automático e responda o cliente**. A primeira metade já existia; a
 * segunda não: `precisaHumano` sem prazo só era limpo por gente na inbox, e a
 * bateria de 08/09 mediu o nó sendo PULADO três minutos depois da queda.
 *
 * O que separa "tenta de novo" de "isto é pra humano" é o PRAZO: pausa com data
 * é transitória (provedor fora, saldo, timeout); sem data é handoff de verdade
 * (áudio ilegível, teto de custo, pedido do operador, transferência) e continua
 * esperando gente.
 */
const build = (
  over: {
    conversas?: Array<{ id: string; empresaId: string }>;
    execucao?: { id: string } | null;
  } = {},
) => {
  const prisma = {
    conversation: {
      findMany: vi.fn().mockResolvedValue(over.conversas ?? [{ id: 'conv-1', empresaId: 'emp-1' }]),
      update: vi.fn().mockResolvedValue({}),
    },
    fluxoExecucao: {
      findFirst: vi.fn().mockResolvedValue('execucao' in over ? over.execucao : { id: 'exec-1' }),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  const conversarIa = { varrerPendentesAposDestravar: vi.fn().mockResolvedValue(true) };
  const bus = { execucoesComJobVivo: vi.fn().mockResolvedValue(new Set<string>()) };
  const job = new FluxoTriggersJob(
    prisma as never,
    {} as never,
    bus as never,
    { get: (k: string) => (k === 'NODE_ENV' ? 'production' : '') } as never,
    {} as never,
    {} as never,
    conversarIa as never,
    {} as never,
    {} as never,
  );
  return { job, prisma, conversarIa };
};

/** A varredura é privada — o cron é a porta pública dela. */
const rodar = async (job: FluxoTriggersJob) => {
  await (
    job as unknown as { retomarConversasPausadas: () => Promise<void> }
  ).retomarConversasPausadas.call(job);
};

describe('retomada depois da falha da IA', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  it('só procura pausa COM PRAZO já vencido', async () => {
    await rodar(ctx.job);

    const where = ctx.prisma.conversation.findMany.mock.calls[0][0].where as Record<
      string,
      unknown
    >;
    expect(where.precisaHumano).toBe(true);
    // `not: null` é o que protege o handoff de verdade: escalada sem prazo não
    // pode ser desfeita por robô.
    expect(where.botPausadoAte).toMatchObject({ not: null });
    expect((where.botPausadoAte as { lte: Date }).lte).toBeInstanceOf(Date);
  });

  it('destrava a conversa e RESPONDE quem ficou esperando', async () => {
    await rodar(ctx.job);

    expect(ctx.prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1' },
        data: { precisaHumano: false, botPausadoAte: null },
      }),
    );
    // Destravar sem varrer é recuperação só no papel: o cliente mandou a
    // mensagem ANTES da queda e pode não escrever de novo.
    expect(ctx.conversarIa.varrerPendentesAposDestravar).toHaveBeenCalledWith('exec-1');
  });

  it('sem execução esperando, destravar já basta', async () => {
    const c = build({ execucao: null });

    await rodar(c.job);

    expect(c.prisma.conversation.update).toHaveBeenCalled();
    expect(c.conversarIa.varrerPendentesAposDestravar).not.toHaveBeenCalled();
  });

  it('falha ao responder uma conversa não impede as outras', async () => {
    const c = build({
      conversas: [
        { id: 'conv-1', empresaId: 'emp-1' },
        { id: 'conv-2', empresaId: 'emp-1' },
      ],
    });
    c.conversarIa.varrerPendentesAposDestravar.mockRejectedValueOnce(new Error('openai fora'));

    await rodar(c.job);

    expect(c.conversarIa.varrerPendentesAposDestravar).toHaveBeenCalledTimes(2);
  });

  it('nada pausado = nada a fazer (o cron roda a cada 5min)', async () => {
    const c = build({ conversas: [] });

    await rodar(c.job);

    expect(c.prisma.conversation.update).not.toHaveBeenCalled();
  });
});

describe('a pausa nasce COM PRAZO', () => {
  const build = () => {
    const prisma = {
      conversation: { update: vi.fn().mockResolvedValue({}) },
      fluxoExecucao: { findUnique: vi.fn().mockResolvedValue({ empresaId: 'emp-1' }) },
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
    const marcar = (ctx: Record<string, unknown>) =>
      (
        svc as unknown as {
          marcarPrecisaHumano: (c: unknown, t: string, e: string) => Promise<void>;
        }
      ).marcarPrecisaHumano(ctx, 'provedor_fora', 'exec-1');
    return { marcar, prisma };
  };

  it('falha da IA pausa com data — é o que faz a conversa voltar sozinha', async () => {
    const { marcar, prisma } = build();
    const antes = Date.now();

    await marcar({ conversationId: 'conv-1' });

    const data = prisma.conversation.update.mock.calls[0][0].data as {
      precisaHumano: boolean;
      botPausadoAte: Date;
    };
    expect(data.precisaHumano).toBe(true);
    // Sem a data, `precisaHumano` só sai por gente na inbox: era assim que a
    // conversa ficava muda até alguém perceber.
    expect(data.botPausadoAte).toBeInstanceOf(Date);
    expect(data.botPausadoAte.getTime()).toBeGreaterThan(antes);
  });
});
