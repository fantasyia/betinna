import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DeadLetterService } from './dead-letter.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeQueueMock = () => ({
  add: vi.fn().mockResolvedValue({ id: 'dl-job-1' }),
  getJobs: vi.fn().mockResolvedValue([]),
  getJob: vi.fn().mockResolvedValue(null),
});

const fakeJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-orig-1',
  name: 'enviar',
  data: { campanhaId: 'camp-1', destinatarioId: 'dest-1', empresaId: 'emp-1' },
  timestamp: Date.now(),
  attemptsMade: 3,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('DeadLetterService', () => {
  let queue: ReturnType<typeof makeQueueMock>;
  let service: DeadLetterService;

  beforeEach(() => {
    queue = makeQueueMock();
    service = new DeadLetterService(queue as never);
  });

  // -------------------------------------------------------------------------
  // record
  // -------------------------------------------------------------------------

  describe('record', () => {
    it('enfileira job no dead-letter com os metadados do job original', async () => {
      const originalJob = fakeJob();
      const error = new Error('Max retries exceeded');

      await service.record({
        originalQueue: 'campanha-envio',
        originalJob: originalJob as never,
        error,
      });

      expect(queue.add).toHaveBeenCalledWith(
        'failed-job',
        expect.objectContaining({
          originalQueue: 'campanha-envio',
          originalJobId: 'job-orig-1',
          originalJobName: 'enviar',
          error: 'Max retries exceeded',
          empresaId: 'emp-1',
        }),
        expect.objectContaining({ attempts: 1 }),
      );
    });

    it('aceita erro como string', async () => {
      await service.record({
        originalQueue: 'fluxo-execucao',
        originalJob: fakeJob({ data: {} }) as never,
        error: 'Timeout error',
      });

      const payload = queue.add.mock.calls[0][1];
      expect(payload.error).toBe('Timeout error');
    });

    it('infere empresaId como undefined quando não está no job data', async () => {
      await service.record({
        originalQueue: 'some-queue',
        originalJob: fakeJob({ data: { outro: 'campo' } }) as never,
        error: new Error('Fail'),
      });

      const payload = queue.add.mock.calls[0][1];
      expect(payload.empresaId).toBeUndefined();
    });

    it('não lança quando queue.add falha (best-effort)', async () => {
      queue.add.mockRejectedValue(new Error('Redis connection refused'));

      await expect(
        service.record({
          originalQueue: 'campanha-envio',
          originalJob: fakeJob() as never,
          error: new Error('Some error'),
        }),
      ).resolves.toBeUndefined();
    });

    it('inclui stack trace truncado a 4000 chars quando disponível', async () => {
      const err = new Error('Complex error');
      err.stack = 'Error: Complex error\n' + 'x'.repeat(5000);

      await service.record({
        originalQueue: 'test-queue',
        originalJob: fakeJob() as never,
        error: err,
      });

      const payload = queue.add.mock.calls[0][1];
      expect(payload.stack).toBeDefined();
      expect((payload.stack as string).length).toBeLessThanOrEqual(4000);
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('retorna lista formatada dos jobs', async () => {
      queue.getJobs.mockResolvedValue([
        {
          id: 'dl-1',
          timestamp: 1234567890,
          data: { originalQueue: 'campanha-envio', error: 'Fail' },
        },
      ]);

      const result = await service.list(50);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'dl-1',
        addedAt: 1234567890,
        data: expect.objectContaining({ originalQueue: 'campanha-envio' }),
      });
    });

    it('usa limit=50 por padrão e passa para getJobs', async () => {
      queue.getJobs.mockResolvedValue([]);

      await service.list();

      expect(queue.getJobs).toHaveBeenCalledWith(
        expect.any(Array),
        0,
        49, // limit-1
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  // retry
  // -------------------------------------------------------------------------

  describe('retry', () => {
    it('lança quando job não é encontrado no dead-letter', async () => {
      queue.getJob.mockResolvedValue(null);

      await expect(service.retry('dl-99', new Map())).rejects.toThrow('não encontrado');
    });

    it('lança quando queue original não está no registry', async () => {
      queue.getJob.mockResolvedValue({
        id: 'dl-1',
        data: { originalQueue: 'campanha-envio', originalJobName: 'enviar', originalData: {} },
        remove: vi.fn(),
      });

      await expect(service.retry('dl-1', new Map())).rejects.toThrow(
        'Queue original campanha-envio não registrada',
      );
    });

    it('reenfileira na queue original e remove do dead-letter', async () => {
      const removeMock = vi.fn().mockResolvedValue(undefined);
      queue.getJob.mockResolvedValue({
        id: 'dl-1',
        data: { originalQueue: 'campanha-envio', originalJobName: 'enviar', originalData: { x: 1 } },
        remove: removeMock,
      });

      const targetQueue = { add: vi.fn().mockResolvedValue({ id: 'new-job-1' }) };
      const registry = new Map([['campanha-envio', targetQueue as never]]);

      const result = await service.retry('dl-1', registry);

      expect(targetQueue.add).toHaveBeenCalledWith(
        'enviar',
        { x: 1 },
        expect.objectContaining({ attempts: 3 }),
      );
      expect(removeMock).toHaveBeenCalledOnce();
      expect(result).toEqual({ ok: true, reenqueuedAs: 'new-job-1' });
    });
  });
});
