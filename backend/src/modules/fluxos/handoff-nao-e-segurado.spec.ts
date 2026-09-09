import { describe, expect, it, vi } from 'vitest';
import { FluxoEventBusService } from './fluxo-event-bus.service';

/**
 * Handoff entre fluxos NÃO pode ser segurado pela guarda de turno de IA.
 *
 * Regressão de produção em 09/09, e o modo de falhar foi pior que o defeito que
 * ela veio consertar: o `1ddb08b` trocou "3 perguntas repetidas" por "30 minutos
 * de silêncio", e de forma determinística.
 *
 *   20:36:36  CLIENTE → "opa, o disjuntor geral aqui e de 63A"
 *   20:36:40  CLIENTE → "a tensao e 220V"
 *   20:36:45  CLIENTE → "e pra minha padaria, aquele freezer que queimou"
 *   BOT       → (nada)
 *
 * O T1 aplica `Tag: retomou` pra passar a bola pro RT. Quem aplica é a PRÓPRIA
 * execução do T1 — que está EM_EXECUCAO e cujo fluxo TEM nó de IA (mesmo já
 * tendo pulado ele, porque o lead estava triado). A guarda via "turno aberto" e
 * segurava o RT por 30 minutos.
 *
 * A execução que EMITE o evento não pode contar como turno aberto contra ele —
 * mesma ideia do `cancelarExecucoesDoLead`, que se exclui pra não se matar no
 * meio. `_hops` já marca a cadeia interna e serve de sinal.
 */
const build = (turnoAberto: boolean) => {
  const prisma = {
    fluxo: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'fluxo-rt',
          nome: 'RT',
          empresaId: 'emp-1',
          status: 'ATIVO',
          nos: [{ id: 'no-trigger', config: {} }],
          triggerConfig: {},
        },
      ]),
    },
    fluxoNo: { count: vi.fn().mockResolvedValue(0) },
    fluxoExecucao: {
      create: vi.fn().mockResolvedValue({ id: 'exec-nova' }),
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    conversation: { findFirst: vi.fn().mockResolvedValue(null) },
    lead: { findFirst: vi.fn().mockResolvedValue(null) },
    $queryRaw: vi.fn().mockResolvedValue(turnoAberto ? [{ id: 'exec-viva' }] : []),
  };
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
  const bus = new FluxoEventBusService(prisma as never, queue as never);
  return { bus, prisma, queue };
};

describe('guarda de turno de IA vs. handoff entre fluxos', () => {
  it('evento DE DENTRO da cadeia passa, mesmo com turno aberto', async () => {
    // É o T1 → `retomou` → RT. Segurar isto é o que produziu o silêncio.
    const { bus, prisma } = build(true);

    await bus.disparar('emp-1', 'LEAD_RECEBEU_TAG', {
      leadId: 'lead-1',
      tagNome: 'retomou',
      _hops: 1,
    });

    expect(prisma.fluxoExecucao.create).toHaveBeenCalled();
  });

  it('evento DE FORA continua sendo segurado — é o RB.10', async () => {
    // Varredura de SLA, cron, etiqueta posta por gente: essas SIM não podem
    // falar por cima de um turno de IA aberto.
    const { bus, prisma } = build(true);

    await bus.disparar('emp-1', 'LEAD_RECEBEU_TAG', {
      leadId: 'lead-1',
      tagNome: 'parado:qualificando',
    });

    expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
  });

  it('sem turno aberto, evento de fora passa normalmente', async () => {
    const { bus, prisma } = build(false);

    await bus.disparar('emp-1', 'LEAD_RECEBEU_TAG', { leadId: 'lead-1', tagNome: 'cold' });

    expect(prisma.fluxoExecucao.create).toHaveBeenCalled();
  });

  it('o adiamento do evento de fora é REAGENDADO, não descartado', async () => {
    const { bus, queue } = build(true);

    await bus.disparar('emp-1', 'LEAD_RECEBEU_TAG', {
      leadId: 'lead-1',
      tagNome: 'parado:qualificando',
    });

    expect(queue.add).toHaveBeenCalled();
  });
});
