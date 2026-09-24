import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FluxoTriggerTipo } from '@prisma/client';
import { FluxoEventBusService } from './fluxo-event-bus.service';

/**
 * A porta única de nutrição PELO BARRAMENTO (P6b).
 *
 * A regra em si é testada pura em `nutricao-porta-unica.spec.ts`. O que se prova
 * aqui é o que só o bus pode errar: ler a config do tenant, enxergar as réguas
 * em curso do lead, cancelar a que perdeu e — o principal — **não criar
 * execução** pra quem foi recusado.
 */
const REGUAS_EM_CURSO = [
  { execucaoId: 'exec-e1', fluxoId: 'f-e1', fluxoNome: 'E1 · Quem chegou sozinho' },
];

const makePrisma = (emCurso: unknown[] = []) => {
  const p: Record<string, unknown> = {
    fluxo: { findMany: vi.fn() },
    fluxoNo: { count: vi.fn().mockResolvedValue(0) },
    fluxoExecucao: {
      create: vi.fn().mockResolvedValue({ id: 'exec-nova', jobId: null }),
      update: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    empresa: { findUnique: vi.fn().mockResolvedValue({ config: {} }) },
    tag: { findFirst: vi.fn().mockResolvedValue(null) },
    conversation: { findFirst: vi.fn().mockResolvedValue(null) },
    // O bus usa $queryRaw pra mais de uma coisa (o guard de turno de IA aberto,
    // inclusive). Casar por "FluxoExecucao" devolveria as réguas pra ele também,
    // e o fluxo seria pulado por outro motivo — falso negativo que custou uma
    // rodada. O alias `fluxoNome` só existe na consulta desta porta.
    $queryRaw: vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
      return Promise.resolve(sql.includes('fluxoNome') ? emCurso : []);
    }),
    $executeRaw: vi.fn().mockResolvedValue(0),
  };
  p.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(p) : Promise.all(arg as never),
  );
  return p as typeof p & {
    fluxo: { findMany: ReturnType<typeof vi.fn> };
    fluxoExecucao: { create: ReturnType<typeof vi.fn> };
  };
};

const fluxo = (id: string, nome: string) => ({
  id,
  nome,
  empresaId: 'emp-1',
  status: 'ATIVO',
  triggerTipo: 'LEAD_RECEBEU_TAG',
  nos: [{ id: `no-${id}` }],
});

const envMock = { get: () => '' };
const disparar = (prisma: ReturnType<typeof makePrisma>) => {
  const svc = new FluxoEventBusService(
    prisma as never,
    { add: vi.fn().mockResolvedValue({ id: 'job-1' }) } as never,
    envMock as never,
  );
  return (f: ReturnType<typeof fluxo>) => {
    (prisma.fluxo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([f]);
    return svc.disparar('emp-1', 'LEAD_RECEBEU_TAG' as FluxoTriggerTipo, { leadId: 'lead-1' });
  };
};

describe('porta única de nutrição no barramento', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => vi.clearAllMocks());

  it('lead JÁ no E1 e o E2 dispara → NÃO cria execução (o E2 perde a vez)', async () => {
    prisma = makePrisma(REGUAS_EM_CURSO);
    await disparar(prisma)(fluxo('f-e2', 'E2 · Primeiro contato frio'));

    expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
  });

  it('lead JÁ no E1 e o E6 dispara → cria E CANCELA a execução do E1', async () => {
    prisma = makePrisma(REGUAS_EM_CURSO);
    await disparar(prisma)(fluxo('f-e6', 'E6 · Abandono de checkout'));

    expect(prisma.fluxoExecucao.create).toHaveBeenCalledTimes(1);
    const cancel = (prisma.fluxoExecucao as Record<string, ReturnType<typeof vi.fn>>).updateMany;
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['exec-e1'] } },
        data: expect.objectContaining({ status: 'CANCELADO' }),
      }),
    );
  });

  it('lead livre → a régua entra normalmente', async () => {
    prisma = makePrisma([]);
    await disparar(prisma)(fluxo('f-e2', 'E2 · Primeiro contato frio'));

    expect(prisma.fluxoExecucao.create).toHaveBeenCalledTimes(1);
  });

  it('⛔ E5 (pediu pra sair) entra mesmo com régua em curso — opt-out nunca é bloqueado', async () => {
    prisma = makePrisma(REGUAS_EM_CURSO);
    await disparar(prisma)(fluxo('f-e5', 'E5 · Pediu pra sair'));

    expect(prisma.fluxoExecucao.create).toHaveBeenCalledTimes(1);
  });

  it('fluxo fora da disputa não paga o custo: nem lê as réguas em curso', async () => {
    prisma = makePrisma(REGUAS_EM_CURSO);
    await disparar(prisma)(fluxo('f-x', 'Boas Vindas'));

    const consultas = (prisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(Array.isArray(c[0]) ? c[0].join(' ') : c[0]).includes('fluxoNome'),
    );
    expect(consultas).toHaveLength(0);
    expect(prisma.fluxoExecucao.create).toHaveBeenCalledTimes(1);
  });

  it('`nutricao.ativo: false` no tenant devolve o comportamento anterior', async () => {
    prisma = makePrisma(REGUAS_EM_CURSO);
    (prisma.empresa as Record<string, ReturnType<typeof vi.fn>>).findUnique.mockResolvedValue({
      config: { nutricao: { ativo: false } },
    });
    await disparar(prisma)(fluxo('f-e2', 'E2 · Primeiro contato frio'));

    expect(prisma.fluxoExecucao.create).toHaveBeenCalledTimes(1);
  });

  it('config ilegível não derruba o disparo — vale o padrão', async () => {
    prisma = makePrisma([]);
    (prisma.empresa as Record<string, ReturnType<typeof vi.fn>>).findUnique.mockRejectedValue(
      new Error('conexão caiu'),
    );
    await disparar(prisma)(fluxo('f-e1', 'E1 · Quem chegou sozinho'));

    expect(prisma.fluxoExecucao.create).toHaveBeenCalledTimes(1);
  });

  it('🔴 E2.3 · MESMA etiqueta reaplicada → NÃO cria a segunda execução do E2', async () => {
    // O caso medido em 15/09: aplicar `nutrir:email` duas vezes, com 60s entre
    // elas, criava DUAS execuções vivas do E2 no mesmo lead. O registro de
    // LeadTag é UM só (o upsert não muda nada) e mesmo assim o evento sai.
    prisma = makePrisma([
      { execucaoId: 'exec-e2-viva', fluxoId: 'f-e2', fluxoNome: 'E2 · Primeiro contato frio' },
    ]);
    await disparar(prisma)(fluxo('f-e2', 'E2 · Primeiro contato frio'));

    expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
    const cancel = (prisma.fluxoExecucao as Record<string, ReturnType<typeof vi.fn>>).updateMany;
    expect(cancel).not.toHaveBeenCalled(); // a que já roda continua viva
  });

  it('a consulta das réguas em curso IGNORA execução de teste', async () => {
    // Execução de bancada não pode calar régua de produção — seria a testadora
    // silenciando lead real sem saber.
    prisma = makePrisma([]);
    await disparar(prisma)(fluxo('f-e2', 'E2 · Primeiro contato frio'));

    const sql = (prisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(Array.isArray(c[0]) ? c[0].join(' ') : c[0]))
      .find((q) => q.includes('fluxoNome'));
    expect(sql).toMatch(/teste/);
  });

  it('evento SEM lead não entra na disputa (nem consulta config)', async () => {
    prisma = makePrisma([]);
    const svc = new FluxoEventBusService(
      prisma as never,
      { add: vi.fn().mockResolvedValue({ id: 'job-1' }) } as never,
      envMock as never,
    );
    (prisma.fluxo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      fluxo('f-e2', 'E2 · Primeiro contato frio'),
    ]);
    await svc.disparar('emp-1', 'LEAD_RECEBEU_TAG' as FluxoTriggerTipo, {});

    expect(
      (prisma.empresa as Record<string, ReturnType<typeof vi.fn>>).findUnique,
    ).not.toHaveBeenCalled();
    expect(prisma.fluxoExecucao.create).toHaveBeenCalledTimes(1);
  });
});
