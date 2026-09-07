import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { FluxoTriggerTipo } from '@prisma/client';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import { FluxoExecutorProcessor } from './fluxo-executor.processor';
import { FLUXO_JOB_REDISPARO, type FluxoJobData } from './fluxo-executor.types';

/**
 * RB.10, reproduzido em prod 07/09: a reabordagem (gatilho `parado:<etapa>`)
 * falou por cima de um turno de IA aberto — o cliente tinha sido perguntado
 * sobre a corrente do disjuntor 1min43 antes — e o supersede de re-entrada
 * cancelou o turno, repetindo a mesma pergunta.
 *
 * O que estes testes travam: gatilho PROATIVO não fala enquanto há turno de IA
 * aberto na conversa, gatilho REATIVO continua passando (senão a própria
 * conversa emudece), e o disparo suprimido VOLTA — não é descartado.
 */

const makeQueue = () => ({ add: vi.fn().mockResolvedValue({ id: 'job-1' }) });

const makePrisma = (turnoAberto: boolean) => ({
  fluxo: {
    findMany: vi.fn().mockResolvedValue([
      {
        id: 'fluxo-rb',
        nome: 'RB — reabordagem',
        empresaId: 'emp-1',
        status: 'ATIVO',
        nos: [{ id: 'no-trigger', config: {} }],
        triggerConfig: {},
      },
    ]),
  },
  fluxoNo: { count: vi.fn().mockResolvedValue(1) },
  fluxoExecucao: {
    create: vi.fn().mockResolvedValue({ id: 'exec-nova' }),
    update: vi.fn().mockResolvedValue({}),
    findFirst: vi.fn().mockResolvedValue(null),
  },
  conversation: { findFirst: vi.fn().mockResolvedValue(null) },
  tag: { findFirst: vi.fn().mockResolvedValue(null) },
  $executeRaw: vi.fn().mockResolvedValue(0),
  $queryRaw: vi.fn().mockResolvedValue(turnoAberto ? [{ id: 'exec-c1' }] : []),
});

const CTX = { leadId: 'lead-1', conversationId: 'conv-1', tagNome: 'parado:qualificando' };

describe('Gatilho proativo x turno de IA aberto', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let queue: ReturnType<typeof makeQueue>;

  const build = (turnoAberto: boolean) => {
    prisma = makePrisma(turnoAberto);
    queue = makeQueue();
    return new FluxoEventBusService(prisma as never, queue as never);
  };

  it('turno de IA aberto: a reabordagem NÃO fala e NÃO cria execução', async () => {
    const bus = build(true);

    await bus.disparar('emp-1', 'LEAD_RECEBEU_TAG' as FluxoTriggerTipo, CTX);

    expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
    // e não encostou no supersede — era ele que cancelava o turno do consultivo
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('o disparo suprimido VOLTA em 30min — descartar deixaria o lead sem reabordagem pra sempre', async () => {
    // A etiqueta `parado:` é aplicada uma única vez e a varredura de SLA exclui
    // quem já a tem: sem o re-disparo, quem estivesse conversando na hora do
    // estouro nunca mais seria reabordado.
    const bus = build(true);

    await bus.disparar('emp-1', 'LEAD_RECEBEU_TAG' as FluxoTriggerTipo, CTX);

    const [nome, payload, opts] = queue.add.mock.calls[0];
    expect(nome).toBe(FLUXO_JOB_REDISPARO);
    expect(payload).toMatchObject({
      empresaId: 'emp-1',
      triggerTipo: 'LEAD_RECEBEU_TAG',
      contexto: { leadId: 'lead-1', _redisparo: 1 },
    });
    expect(opts.delay).toBe(30 * 60_000);
  });

  it('"turno aberto" = parado NO nó de IA ou com o lock do turno — não é "qualquer execução viva"', async () => {
    // Um DELAY de 3 dias num fluxo qualquer não pode emudecer a conversa.
    const bus = build(true);

    await bus.disparar('emp-1', 'LEAD_RECEBEU_TAG' as FluxoTriggerTipo, CTX);

    const [sql, ...params] = prisma.$queryRaw.mock.calls[0];
    const texto = (sql as unknown as string[]).join('?');
    expect(texto).toContain('CONVERSAR_IA');
    expect(texto).toContain('processandoTurno');
    expect(texto).toContain('aguardandoNoId');
    expect(params).toEqual(['emp-1', 'conv-1', 'lead-1']);
  });

  it('conversa livre: a reabordagem dispara normalmente', async () => {
    const bus = build(false);

    await bus.disparar('emp-1', 'LEAD_RECEBEU_TAG' as FluxoTriggerTipo, CTX);

    expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
    expect(queue.add.mock.calls[0][0]).toBe('step');
  });

  it('gatilho REATIVO passa mesmo com turno aberto — é a própria conversa andando', async () => {
    // LEAD_ETAPA_MUDOU é emitido pelo ramo da IA que classificou o lead: segurá-lo
    // quebraria o handoff entre fluxos, que é o caminho normal.
    const bus = build(true);

    await bus.disparar('emp-1', 'LEAD_ETAPA_MUDOU' as FluxoTriggerTipo, CTX);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
  });

  it('teto de 24h: no 49o re-disparo desiste em vez de virar loop eterno', async () => {
    const bus = build(true);

    await bus.disparar('emp-1', 'LEAD_RECEBEU_TAG' as FluxoTriggerTipo, {
      ...CTX,
      _redisparo: 48,
    });

    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
  });

  it('sem lead nem conversa no evento não há o que consultar (cron de empresa)', async () => {
    const bus = build(true);

    await bus.disparar('emp-1', 'CRON_AGENDADO' as FluxoTriggerTipo, {});

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
  });
});

describe('FluxoExecutorProcessor — job de re-disparo', () => {
  it('republica o MESMO evento no bus, sem passar pelo executor', async () => {
    const executor = { executarPasso: vi.fn() };
    const bus = { disparar: vi.fn().mockResolvedValue(undefined) };
    const proc = new FluxoExecutorProcessor(
      executor as never,
      {} as never,
      {} as never,
      bus as never,
    );
    const job = {
      id: 'job-9',
      name: FLUXO_JOB_REDISPARO,
      data: {
        empresaId: 'emp-1',
        triggerTipo: 'LEAD_RECEBEU_TAG',
        contexto: { leadId: 'lead-1', _redisparo: 1 },
      },
      attemptsMade: 0,
    } as unknown as Job<FluxoJobData>;

    await proc.process(job);

    expect(bus.disparar).toHaveBeenCalledWith('emp-1', 'LEAD_RECEBEU_TAG', {
      leadId: 'lead-1',
      _redisparo: 1,
    });
    expect(executor.executarPasso).not.toHaveBeenCalled();
  });
});
