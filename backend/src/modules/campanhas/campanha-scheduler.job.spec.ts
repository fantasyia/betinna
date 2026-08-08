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
    // Cancelar usa updateMany com guard de status (não pisa em campanha ENVIANDO).
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

    expect(prisma.campanha.updateMany).toHaveBeenCalledWith({
      where: { id: 'camp-1', status: { in: ['RASCUNHO', 'AGENDADA'] } },
      data: { status: 'CANCELADA' },
    });
  });

  it('segmento vazio (CAMPANHA_SEM_DESTINATARIOS) → CANCELADA', async () => {
    campanhas.disparar.mockRejectedValue(
      new BusinessRuleException('Nenhum destinatário…', ErrorCode.CAMPANHA_SEM_DESTINATARIOS),
    );

    await job.avaliarAgendadas();

    expect(prisma.campanha.updateMany).toHaveBeenCalledWith({
      where: { id: 'camp-1', status: { in: ['RASCUNHO', 'AGENDADA'] } },
      data: { status: 'CANCELADA' },
    });
  });

  it('erro transiente (sem code de não-disparável) NÃO cancela — deixa pra próxima janela', async () => {
    campanhas.disparar.mockRejectedValue(new Error('Redis timeout'));

    await job.avaliarAgendadas();

    expect(prisma.campanha.updateMany).not.toHaveBeenCalled();
  });

  it('NÃO cancela campanha que já saiu de AGENDADA (disparo manual em paralelo)', async () => {
    // O bug: CAMPANHA_NAO_PODE_DISPARAR também é lançado quando a campanha já
    // está ENVIANDO — o scheduler cancelava um envio em pleno curso.
    campanhas.disparar.mockRejectedValue(
      new BusinessRuleException(
        'Campanha em status ENVIANDO não pode ser disparada',
        ErrorCode.CAMPANHA_NAO_PODE_DISPARAR,
      ),
    );
    prisma.campanha.updateMany.mockResolvedValue({ count: 0 }); // guard não casou

    await job.avaliarAgendadas();

    // Tentou com o guard de status, e o guard protegeu (count 0 = nada mudou).
    const where = prisma.campanha.updateMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['RASCUNHO', 'AGENDADA'] });
  });
});
