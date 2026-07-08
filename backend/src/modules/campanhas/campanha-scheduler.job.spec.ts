import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { CampanhaSchedulerJob } from './campanha-scheduler.job';

const makePrisma = () => ({
  campanha: {
    findMany: vi
      .fn()
      .mockResolvedValue([
        { id: 'camp-1', empresaId: 'emp-1', criadoPorId: 'u-1', nome: 'Agendada X' },
      ]),
    update: vi.fn().mockResolvedValue({}),
  },
});
const makeCronLock = () => ({ acquire: vi.fn().mockResolvedValue(true) });

describe('CampanhaSchedulerJob — #R6 campanha agendada não-disparável vira CANCELADA', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let cronLock: ReturnType<typeof makeCronLock>;
  let campanhas: { disparar: ReturnType<typeof vi.fn> };
  let job: CampanhaSchedulerJob;

  beforeEach(() => {
    prisma = makePrisma();
    cronLock = makeCronLock();
    campanhas = { disparar: vi.fn() };
    job = new CampanhaSchedulerJob(prisma as never, campanhas as never, cronLock as never);
  });

  it('cap de IA (CAMPANHA_NAO_PODE_DISPARAR) → CANCELADA (antes evaporava pra RASCUNHO)', async () => {
    campanhas.disparar.mockRejectedValue(
      new BusinessRuleException(
        'Campanha com IA é limitada…',
        ErrorCode.CAMPANHA_NAO_PODE_DISPARAR,
      ),
    );

    await job.avaliarAgendadas();

    expect(prisma.campanha.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { status: 'CANCELADA' },
    });
  });

  it('segmento vazio (CAMPANHA_SEM_DESTINATARIOS) → CANCELADA', async () => {
    campanhas.disparar.mockRejectedValue(
      new BusinessRuleException('Nenhum destinatário…', ErrorCode.CAMPANHA_SEM_DESTINATARIOS),
    );

    await job.avaliarAgendadas();

    expect(prisma.campanha.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { status: 'CANCELADA' },
    });
  });

  it('erro transiente (sem code de não-disparável) NÃO cancela — deixa pra próxima janela', async () => {
    campanhas.disparar.mockRejectedValue(new Error('Redis timeout'));

    await job.avaliarAgendadas();

    expect(prisma.campanha.update).not.toHaveBeenCalled();
  });
});
