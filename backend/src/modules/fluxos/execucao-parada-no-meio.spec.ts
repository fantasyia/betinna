import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoTriggersJob } from './fluxo-triggers.job';

/**
 * Execução PARADA NO MEIO — o estado que, pela semântica do motor, não deveria
 * existir: `EM_EXECUCAO`, sem turno em processamento, sem nó aguardando, sem
 * erro e sem job na fila. Não está fazendo nada e não vai acordar sozinha.
 *
 * Medido em 07/09: o C1 moveu o lead de etapa, o passo concluiu às 19:45:03 e a
 * execução parou ali — 2 logs, 2 claims, nenhum terceiro. O lead ficou sem
 * resposta no meio do acolhimento, sem erro e sem alarme; a única evidência era
 * uma conversa que simplesmente parou.
 */
const UM_MINUTO = 60 * 1000;
const VELHO = new Date(Date.now() - 30 * UM_MINUTO);

const makePrisma = () => ({
  fluxoStepClaim: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    findFirst: vi.fn().mockResolvedValue({ proximos: ['no-3'] }),
  },
  fluxoNo: { findFirst: vi.fn().mockResolvedValue({ id: 'no-trigger' }) },
  fluxoExecucao: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
  },
});

const parada = (over: Record<string, unknown> = {}) => ({
  id: 'exec-1',
  contexto: {},
  fluxo: { nome: 'C1 · Consultivo' },
  logs: [
    {
      noId: 'no-2',
      noTitulo: 'Mover → Em conversa',
      status: 'CONCLUIDO',
      terminadoEm: VELHO,
    },
  ],
  ...over,
});

/** Alerta in-app de quem não pôde ser retomado — o "alguém precisa olhar". */
const notificacoes = { criarParaRole: vi.fn().mockResolvedValue(undefined) };

const makeJob = (prisma: ReturnType<typeof makePrisma>, bus: Record<string, unknown>) =>
  new FluxoTriggersJob(
    prisma as never,
    { criarParaRole: notificacoes.criarParaRole } as never,
    bus as never,
    { get: () => 'production' } as never,
    { acquire: vi.fn().mockResolvedValue(true) } as never,
    notificacoes as never,
    notificacoes as never,
    { responderPendente: vi.fn().mockResolvedValue(false) } as never,
    notificacoes as never,
    notificacoes as never,
  );

const makeBus = (vivos: string[] = []) => ({
  execucoesComJobVivo: vi.fn().mockResolvedValue(new Set(vivos)),
  dispararDireto: vi.fn().mockResolvedValue(undefined),
});

describe('FluxoTriggersJob — execução parada no meio', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    notificacoes.criarParaRole.mockClear();
  });

  it('RETOMA do ponto onde parou, usando os sucessores gravados no claim', async () => {
    prisma.fluxoExecucao.findMany.mockResolvedValue([parada()]);
    const bus = makeBus();

    await makeJob(prisma, bus).alarmeDeFilaParada();

    expect(bus.dispararDireto).toHaveBeenCalledWith(
      'exec-1',
      'no-3',
      expect.objectContaining({ jobId: expect.stringContaining('ret_exec-1_no-3') }),
    );
    // Marca a tentativa: insistir a cada 5min viraria loop eterno.
    expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contexto: expect.objectContaining({ _retomadoEm: expect.any(String) }),
        }),
      }),
    );
  });

  it('execução com job VIVO na fila não é tocada — DELAY de 3 dias é legítimo', async () => {
    prisma.fluxoExecucao.findMany.mockResolvedValue([parada()]);
    const bus = makeBus(['exec-1']);

    await makeJob(prisma, bus).alarmeDeFilaParada();

    expect(bus.dispararDireto).not.toHaveBeenCalled();
    expect(prisma.fluxoExecucao.updateMany).not.toHaveBeenCalled();
  });

  it('sem sucessores gravados não há o que retomar → FALHOU explícito, não silêncio', async () => {
    prisma.fluxoExecucao.findMany.mockResolvedValue([parada()]);
    prisma.fluxoStepClaim.findFirst.mockResolvedValue({ proximos: [] });
    const bus = makeBus();

    await makeJob(prisma, bus).alarmeDeFilaParada();

    expect(bus.dispararDireto).not.toHaveBeenCalled();
    const falhou = prisma.fluxoExecucao.updateMany.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'FALHOU',
    );
    expect(falhou).toBeDefined();
    expect((falhou![0] as { data: { erroMsg: string } }).data.erroMsg).toContain(
      'Mover → Em conversa',
    );
    // O que NÃO deu pra retomar vira alerta: o lead ficou sem resposta e
    // alguém precisa abrir a conversa.
    expect(notificacoes.criarParaRole).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['ADMIN', 'DIRECTOR'] }),
    );
  });

  it('já retomada uma vez: NÃO tenta de novo (senão é loop a cada 5min)', async () => {
    prisma.fluxoExecucao.findMany.mockResolvedValue([
      parada({ contexto: { _retomadoEm: '2026-09-07T19:50:00.000Z' } }),
    ]);
    const bus = makeBus();

    await makeJob(prisma, bus).alarmeDeFilaParada();

    expect(bus.dispararDireto).not.toHaveBeenCalled();
    expect(prisma.fluxoExecucao.updateMany).toHaveBeenCalled();
  });

  it('último passo FALHOU: não é caso daqui (quem trata é a reconciliação)', async () => {
    prisma.fluxoExecucao.findMany.mockResolvedValue([
      parada({ logs: [{ noId: 'no-2', noTitulo: 'x', status: 'FALHOU', terminadoEm: VELHO }] }),
    ]);
    const bus = makeBus();

    await makeJob(prisma, bus).alarmeDeFilaParada();

    expect(bus.dispararDireto).not.toHaveBeenCalled();
    expect(prisma.fluxoExecucao.updateMany).not.toHaveBeenCalled();
  });

  it('passo recém-concluído não é "parado" — dá tempo do próximo entrar na fila', async () => {
    prisma.fluxoExecucao.findMany.mockResolvedValue([
      parada({
        logs: [{ noId: 'no-2', noTitulo: 'x', status: 'CONCLUIDO', terminadoEm: new Date() }],
      }),
    ]);
    const bus = makeBus();

    await makeJob(prisma, bus).alarmeDeFilaParada();

    expect(bus.dispararDireto).not.toHaveBeenCalled();
  });

  it('fila inacessível: não varre nada — sem a lista de jobs, todo DELAY viraria "parada"', async () => {
    prisma.fluxoExecucao.findMany.mockResolvedValue([parada()]);
    const bus = {
      execucoesComJobVivo: vi.fn().mockRejectedValue(new Error('redis fora')),
      dispararDireto: vi.fn(),
    };

    await makeJob(prisma, bus).alarmeDeFilaParada();

    expect(bus.dispararDireto).not.toHaveBeenCalled();
    expect(prisma.fluxoExecucao.updateMany).not.toHaveBeenCalled();
  });
});
