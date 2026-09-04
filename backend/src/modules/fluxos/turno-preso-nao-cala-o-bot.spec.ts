import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversarIaService } from './conversar-ia.service';

/**
 * O turno que trava e deixa o cliente falando sozinho.
 *
 * Aconteceu em produção (29/08): um turno pegou o lock (`processandoTurno`) e
 * nunca voltou — sem erro, sem log, sem entrada no `FluxoExecucaoLog`. Como o
 * claim exigia `processandoTurno: false`, TODA mensagem seguinte saía em
 * silêncio, e a única saída era o reaper de 15 em 15 minutos: **23 minutos de
 * silêncio medidos**, com o bot ligado e o lead parado em Qualificando.
 *
 * Estes testes prendem as duas metades do conserto: o claim tem vida própria
 * (não depende do cron) e o lock velho aparece no log de produção.
 */
function build() {
  const prisma = {
    fluxoExecucao: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    message: { findMany: vi.fn().mockResolvedValue([]) },
    // A varredura resolve a conversa pelo lead quando o contexto não traz.
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
    {} as never,
    {} as never,
  );
  return { svc, prisma };
}

const EXEC = {
  id: 'exec-1',
  status: 'AGUARDANDO',
  aguardandoNoId: 'no-ia',
  empresaId: 'emp-1',
  contexto: { leadId: 'lead-1', conversationId: 'conv-1' },
};

describe('turno preso não pode calar o bot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('o claim aceita lock VELHO — não espera o cron de 15 min', async () => {
    // Sem isto, o lock preso segurava a conversa até o reaper passar: 15min de
    // TTL + 15min de cron = até meia hora de silêncio.
    const { svc, prisma } = build();
    prisma.fluxoExecucao.findUnique.mockResolvedValue({
      ...EXEC,
      processandoTurno: true,
      turnoIniciadoEm: new Date(Date.now() - 10 * 60 * 1000),
    });

    await svc.retomar('exec-1', 'conv-1', 'alô? tem alguém aí?');

    const claim = prisma.fluxoExecucao.updateMany.mock.calls.find((c) =>
      Boolean((c[0] as { data?: Record<string, unknown> }).data?.processandoTurno),
    );
    expect(claim).toBeDefined();
    const where = (claim![0] as { where: { OR?: unknown[] } }).where;
    // A condição do claim deixou de ser só "está livre": aceita também o lock
    // que passou do TTL.
    expect(where.OR).toBeDefined();
    expect(where.OR).toHaveLength(2);
  });

  it('claim negado com lock VELHO vira warn (o único sintoma era o cliente reclamando)', async () => {
    const { svc, prisma } = build();
    prisma.fluxoExecucao.findUnique.mockResolvedValue({
      ...EXEC,
      processandoTurno: true,
      turnoIniciadoEm: new Date(Date.now() - 5 * 60 * 1000),
    });
    prisma.fluxoExecucao.updateMany.mockResolvedValue({ count: 0 }); // outro turno venceu
    const warn = vi
      .spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    await svc.retomar('exec-1', 'conv-1', 'oi');

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/claim negado/i));
  });

  it('rajada normal (lock recém-criado) NÃO vira warn — é turno concorrente legítimo', async () => {
    const { svc, prisma } = build();
    prisma.fluxoExecucao.findUnique.mockResolvedValue({
      ...EXEC,
      processandoTurno: true,
      turnoIniciadoEm: new Date(),
    });
    prisma.fluxoExecucao.updateMany.mockResolvedValue({ count: 0 });
    const warn = vi
      .spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    await svc.retomar('exec-1', 'conv-1', 'tudo bem?');

    expect(warn).not.toHaveBeenCalled();
  });

  it('varrer após destravar não roda em execução que já saiu de AGUARDANDO', async () => {
    // Se a execução avançou, não há turno pendente — varrer criaria resposta a
    // destempo numa conversa que já seguiu.
    const { svc, prisma } = build();
    prisma.fluxoExecucao.findFirst.mockResolvedValue(null);

    expect(await svc.varrerPendentesAposDestravar('exec-1')).toBe(false);
  });

  // Card 🔴 de 04/09: o processo morreu no deploy, o `finally` não rodou, e o
  // reaper soltou o lock 11 minutos depois — mas a varredura de recuperação
  // DESISTIU na primeira linha, porque o C1 (disparado por mudança de etapa) não
  // tinha `conversationId` no contexto. O cliente seguiu sem resposta.
  it('sem conversationId no contexto, a varredura RESOLVE a conversa pelo lead', async () => {
    const { svc, prisma } = build();
    prisma.fluxoExecucao.findFirst.mockResolvedValue({
      id: 'exec-1',
      empresaId: 'emp-1',
      contexto: { leadId: 'lead-1' },
      turnoIniciadoEm: new Date(),
    });
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-do-lead' });

    expect(await svc.varrerPendentesAposDestravar('exec-1')).toBe(true);
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversationId: 'conv-do-lead' }),
      }),
    );
  });

  it('a janela da varredura pega a mensagem que DISPAROU o turno', async () => {
    // A mensagem engolida chega instantes ANTES do claim (medido: 0,6 s). Olhar
    // só depois do claim é olhar para o lado errado do problema.
    const { svc, prisma } = build();
    const inicio = new Date('2026-09-04T20:04:18.658Z');
    prisma.fluxoExecucao.findFirst.mockResolvedValue({
      id: 'exec-1',
      empresaId: 'emp-1',
      contexto: { leadId: 'lead-1', conversationId: 'conv-1' },
      turnoIniciadoEm: inicio,
    });

    await svc.varrerPendentesAposDestravar('exec-1');

    const where = prisma.message.findMany.mock.calls[0]?.[0]?.where;
    expect(where.criadoEm.gt.getTime()).toBeLessThan(inicio.getTime());
  });

  it('sem conversa nenhuma (nem no contexto, nem do lead), desiste — e avisa', async () => {
    const { svc, prisma } = build();
    prisma.fluxoExecucao.findFirst.mockResolvedValue({
      id: 'exec-1',
      empresaId: 'emp-1',
      contexto: { leadId: 'lead-1' },
      turnoIniciadoEm: new Date(),
    });

    expect(await svc.varrerPendentesAposDestravar('exec-1')).toBe(false);
  });
});
