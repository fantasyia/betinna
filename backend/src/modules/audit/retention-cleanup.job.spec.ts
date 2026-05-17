import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RetentionCleanupJob } from './retention-cleanup.job';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makePrismaMock = () => ({
  auditLog: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({ id: 'log-1' }),
  },
  message: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  notificacao: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
});

const makeEnvMock = (overrides: Record<string, unknown> = {}) => {
  const defaults: Record<string, unknown> = {
    NODE_ENV: 'development',
    LGPD_AUDIT_RETENTION_MONTHS: 24,
    LGPD_MESSAGES_RETENTION_MONTHS: 24,
    LGPD_NOTIFICACOES_RETENTION_MONTHS: 6,
  };
  return {
    get: vi.fn((key: string) => overrides[key] ?? defaults[key]),
  };
};

const makeCronLockMock = (acquire = true) => ({
  acquire: vi.fn().mockResolvedValue(acquire),
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RetentionCleanupJob', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let env: ReturnType<typeof makeEnvMock>;
  let cronLock: ReturnType<typeof makeCronLockMock>;
  let job: RetentionCleanupJob;

  beforeEach(() => {
    prisma = makePrismaMock();
    env = makeEnvMock();
    cronLock = makeCronLockMock(true);
    job = new RetentionCleanupJob(prisma as never, env as never, cronLock as never);
  });

  it('não roda em NODE_ENV=test', async () => {
    env = makeEnvMock({ NODE_ENV: 'test' });
    job = new RetentionCleanupJob(prisma as never, env as never, cronLock as never);
    await job.purgeOldRecords();
    expect(cronLock.acquire).not.toHaveBeenCalled();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('não roda se não conseguir cron lock', async () => {
    cronLock = makeCronLockMock(false);
    job = new RetentionCleanupJob(prisma as never, env as never, cronLock as never);
    await job.purgeOldRecords();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('purga AuditLog/Message/Notificacao com cutoffs corretos', async () => {
    prisma.auditLog.deleteMany.mockResolvedValue({ count: 5 });
    prisma.message.deleteMany.mockResolvedValue({ count: 3 });
    prisma.notificacao.deleteMany.mockResolvedValue({ count: 2 });

    await job.purgeOldRecords();

    expect(prisma.auditLog.deleteMany).toHaveBeenCalledOnce();
    expect(prisma.message.deleteMany).toHaveBeenCalledOnce();
    expect(prisma.notificacao.deleteMany).toHaveBeenCalledOnce();

    // Notificacao só purga lidas
    const notifArgs = prisma.notificacao.deleteMany.mock.calls[0][0];
    expect(notifArgs.where.lidaEm).toEqual({ not: null });
  });

  it('pula tabela quando retention = 0', async () => {
    env = makeEnvMock({
      LGPD_AUDIT_RETENTION_MONTHS: 0,
      LGPD_MESSAGES_RETENTION_MONTHS: 0,
      LGPD_NOTIFICACOES_RETENTION_MONTHS: 0,
    });
    job = new RetentionCleanupJob(prisma as never, env as never, cronLock as never);
    await job.purgeOldRecords();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(prisma.message.deleteMany).not.toHaveBeenCalled();
    expect(prisma.notificacao.deleteMany).not.toHaveBeenCalled();
  });

  it('registra auto-audit quando purga algo', async () => {
    prisma.auditLog.deleteMany.mockResolvedValue({ count: 10 });
    await job.purgeOldRecords();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acao: 'PURGE',
          recurso: 'retention-cleanup',
        }),
      }),
    );
  });

  it('NÃO registra auto-audit quando nada foi purgado', async () => {
    // Todos retornam count=0 por default
    await job.purgeOldRecords();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('não lança quando deleteMany falha em uma tabela (continua nas outras)', async () => {
    prisma.auditLog.deleteMany.mockRejectedValue(new Error('DB timeout'));
    prisma.message.deleteMany.mockResolvedValue({ count: 3 });

    await expect(job.purgeOldRecords()).resolves.toBeUndefined();
    expect(prisma.message.deleteMany).toHaveBeenCalledOnce();
  });

  it('cutoff de N meses calculado corretamente', async () => {
    const now = new Date('2026-05-17T00:00:00Z');
    vi.setSystemTime(now);

    await job.purgeOldRecords();

    const auditArgs = prisma.auditLog.deleteMany.mock.calls[0][0];
    const cutoff = auditArgs.where.criadoEm.lt as Date;
    // 24 meses atrás de 2026-05 = 2024-05
    expect(cutoff.getUTCFullYear()).toBe(2024);
    expect(cutoff.getUTCMonth()).toBe(4); // 0-indexed: 4 = maio

    vi.useRealTimers();
  });
});
