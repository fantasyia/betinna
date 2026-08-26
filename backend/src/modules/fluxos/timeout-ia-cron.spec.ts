import { describe, expect, it, vi } from 'vitest';
import { FluxoTriggersJob } from './fluxo-triggers.job';

/**
 * Timeout de conversa tem que ter resolução de MINUTO.
 *
 * O `timeoutHoras` do CONVERSAR_IA grava um `timeoutEm` exato e aceita fração,
 * mas quem detectava o vencimento era a varredura de 30min. O prazo real virava
 * "o configurado, arredondado até a próxima :00/:30": 24h ninguém nota, 30min
 * podia virar 60, e 5min virava até 30 — 6x o prometido, em silêncio.
 *
 * Descoberto em 25/08 testando o T1.9 (não respondeu → tag "Sem resposta" +
 * pausa): o desfecho só veio na virada do cron, não nos 5min configurados.
 */
function build(lockOk = true) {
  const conversarIa = { processarTimeouts: vi.fn().mockResolvedValue(3) };
  const cronLock = { acquire: vi.fn().mockResolvedValue(lockOk) };
  const prisma = { empresa: { findMany: vi.fn().mockResolvedValue([]) } };
  const job = new FluxoTriggersJob(
    prisma as never,
    {} as never,
    { disparar: vi.fn() } as never,
    { get: () => 'production' } as never,
    cronLock as never,
    {} as never,
    conversarIa as never,
    {} as never,
    {} as never,
  );
  return { job, conversarIa, cronLock, prisma };
}

describe('cron de timeout do CONVERSAR_IA', () => {
  it('roda no cron próprio de 1min, com lock próprio', async () => {
    const { job, conversarIa, cronLock } = build();

    await job.avaliarTimeoutsIa();

    expect(conversarIa.processarTimeouts).toHaveBeenCalledTimes(1);
    // Lock separado do de 30min: os dois crons não competem pela mesma chave.
    // TTL 50s expira antes da próxima rodada — lock órfão não trava a fila.
    expect(cronLock.acquire).toHaveBeenCalledWith('fluxo-timeouts-ia', 50);
  });

  it('a varredura de 30min NÃO processa mais timeout (senão seria trabalho em dobro)', async () => {
    const { job, conversarIa } = build();

    await job.avaliarTriggers();

    expect(conversarIa.processarTimeouts).not.toHaveBeenCalled();
  });

  it('sem o lock (outra instância rodando), não processa', async () => {
    const { job, conversarIa } = build(false);

    await job.avaliarTimeoutsIa();

    expect(conversarIa.processarTimeouts).not.toHaveBeenCalled();
  });

  it('falha no processamento não escapa do cron', async () => {
    const { job, conversarIa } = build();
    conversarIa.processarTimeouts.mockRejectedValue(new Error('banco fora'));

    // Sem o try/catch, a exceção subiria pro scheduler do Nest e mataria a
    // rodada — e o cron seguinte só viria um minuto depois, sem sinal nenhum.
    await expect(job.avaliarTimeoutsIa()).resolves.toBeUndefined();
  });
});
