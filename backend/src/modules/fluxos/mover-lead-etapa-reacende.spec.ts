import { describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

/**
 * Os dois defeitos do RT.2, medidos em produção em 05/09 — lead do Canal Reps
 * que volta a falar e não é atendido por ninguém.
 */
const makePrisma = (etapaAtual: string | null, tipoAtual: string | null) => ({
  funilEtapa: {
    findFirst: vi.fn(async () => ({ id: 'etapa-novo', funilId: 'funil-1', tipo: 'ABERTA' })),
  },
  lead: {
    findFirst: vi.fn(async () => ({
      funilEtapaId: etapaAtual,
      etapa: tipoAtual === 'PERDIDO' ? 'PERDIDO' : 'NOVO',
      funilEtapa: tipoAtual ? { tipo: tipoAtual } : null,
    })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  conversation: { updateMany: vi.fn(async () => ({ count: 1 })) },
  leadEtapaHistorico: { create: vi.fn(async () => ({})) },
});

const build = (prisma: ReturnType<typeof makePrisma>) => {
  const bus = { disparar: vi.fn(async () => undefined) };
  const svc = Object.create(FluxoExecutorService.prototype) as FluxoExecutorService;
  Object.assign(svc, {
    prisma,
    bus,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  });
  return { svc, bus, prisma };
};

const ctx = { leadId: 'lead-1', conversationId: 'conv-1' };

describe('MOVER_LEAD_ETAPA — reacender e ressuscitar', () => {
  it('lead JÁ na etapa: por padrão não dispara nada (evita no-op e laço)', async () => {
    const prisma = makePrisma('etapa-novo', 'ABERTA');
    const { svc, bus } = build(prisma);

    await svc['acaoMoverLeadEtapa']({ funilEtapaId: 'etapa-novo' }, ctx as never, 'emp-1');

    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('com reacenderSeJaEstaNaEtapa, dispara mesmo já estando lá — é o que acende o C2', async () => {
    // O RT devolve o lead pra "Canal Reps / Novo" pra que o C2 assuma. Quando
    // ele já estava lá, nenhum evento saía e o lead ficava sem atendimento.
    const prisma = makePrisma('etapa-novo', 'ABERTA');
    const { svc, bus } = build(prisma);

    await svc['acaoMoverLeadEtapa'](
      { funilEtapaId: 'etapa-novo', reacenderSeJaEstaNaEtapa: true },
      ctx as never,
      'emp-1',
    );

    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_ETAPA_MUDOU',
      expect.objectContaining({ leadId: 'lead-1', paraFunilEtapaId: 'etapa-novo' }),
    );
  });

  it('saindo de PERDIDO, limpa o precisaHumano — senão o fluxo que reativou fica mudo', async () => {
    // O bot geral marca precisaHumano ao ver o lead Perdido (certo). Dois
    // segundos depois o fluxo o reativa, e o nó de IA encontrava a flag e se
    // calava: ZERO mensagens, lead parado em "Qualificando" sem tarefa.
    const prisma = makePrisma('etapa-perdido', 'PERDIDO');
    const { svc } = build(prisma);

    await svc['acaoMoverLeadEtapa']({ funilEtapaId: 'etapa-novo' }, ctx as never, 'emp-1');

    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv-1', precisaHumano: true },
      data: { precisaHumano: false },
    });
  });

  it('quem NÃO vinha de Perdido não tem a flag mexida (pode ser áudio ilegível, teto de custo)', async () => {
    const prisma = makePrisma('etapa-qualificando', 'ABERTA');
    const { svc } = build(prisma);

    await svc['acaoMoverLeadEtapa']({ funilEtapaId: 'etapa-novo' }, ctx as never, 'emp-1');

    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });
});
