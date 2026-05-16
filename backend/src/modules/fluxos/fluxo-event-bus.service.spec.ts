import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FluxoTriggerTipo } from '@prisma/client';
import { FluxoEventBusService } from './fluxo-event-bus.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makeQueueMock = () => ({
  add: vi.fn().mockResolvedValue({ id: 'job-1' }),
});

const makePrismaMock = () => ({
  fluxo: {
    findMany: vi.fn(),
  } satisfies MockModel,
  fluxoExecucao: {
    create: vi.fn(),
    update: vi.fn(),
  } satisfies MockModel,
});

const fakeFluxo = (overrides: Record<string, unknown> = {}) => ({
  id: 'fluxo-1',
  nome: 'Boas Vindas',
  empresaId: 'emp-1',
  status: 'ATIVO',
  triggerTipo: 'LEAD_CRIADO',
  nos: [{ id: 'no-trigger-1' }],
  ...overrides,
});

const fakeExecucao = (overrides: Record<string, unknown> = {}) => ({
  id: 'exec-1',
  fluxoId: 'fluxo-1',
  empresaId: 'emp-1',
  status: 'PENDENTE',
  jobId: null,
  contexto: {},
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FluxoEventBusService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let queue: ReturnType<typeof makeQueueMock>;
  let service: FluxoEventBusService;

  beforeEach(() => {
    prisma = makePrismaMock();
    queue = makeQueueMock();
    service = new FluxoEventBusService(prisma as never, queue as never);
  });

  // -------------------------------------------------------------------------
  // disparar
  // -------------------------------------------------------------------------

  describe('disparar', () => {
    it('não faz nada quando não há fluxos ativos para o trigger', async () => {
      prisma.fluxo.findMany.mockResolvedValue([]);

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {});

      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('cria execução e enfileira job para cada fluxo ativo', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo()]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, { clienteId: 'cli-1' });

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
      expect(queue.add).toHaveBeenCalledOnce();
    });

    it('salva jobId na execução após enfileirar', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo()]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao({ id: 'exec-42' }));
      queue.add.mockResolvedValue({ id: 'bullmq-job-99' });
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {});

      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exec-42' },
          data: { jobId: 'bullmq-job-99' },
        }),
      );
    });

    it('filtra fluxos por empresaId, status ATIVO e triggerTipo', async () => {
      prisma.fluxo.findMany.mockResolvedValue([]);

      await service.disparar('emp-5', 'PEDIDO_APROVADO' as FluxoTriggerTipo, {});

      const args = prisma.fluxo.findMany.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-5');
      expect(args.where.status).toBe('ATIVO');
      expect(args.where.triggerTipo).toBe('PEDIDO_APROVADO');
    });

    it('processa múltiplos fluxos para o mesmo trigger', async () => {
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({ id: 'fluxo-1', nos: [{ id: 'trigger-1' }] }),
        fakeFluxo({ id: 'fluxo-2', nos: [{ id: 'trigger-2' }] }),
      ]);
      prisma.fluxoExecucao.create
        .mockResolvedValueOnce(fakeExecucao({ id: 'exec-1' }))
        .mockResolvedValueOnce(fakeExecucao({ id: 'exec-2' }));
      queue.add.mockResolvedValueOnce({ id: 'job-1' }).mockResolvedValueOnce({ id: 'job-2' });
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {});

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledTimes(2);
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('pula fluxo sem nó TRIGGER (sem lançar)', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo({ nos: [] })]);

      // Não deve lançar
      await expect(
        service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {}),
      ).resolves.toBeUndefined();

      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('falha silenciosa — não relança erros (best-effort)', async () => {
      prisma.fluxo.findMany.mockRejectedValue(new Error('DB timeout'));

      // Não deve lançar — bus é best-effort
      await expect(
        service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {}),
      ).resolves.toBeUndefined();
    });

    it('enfileira job com tentativas e backoff configurados', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo()]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {});

      const jobOpts = queue.add.mock.calls[0][2];
      expect(jobOpts.attempts).toBe(3);
      expect(jobOpts.backoff?.type).toBe('exponential');
    });

    it('cria execução com status PENDENTE e contexto passado', async () => {
      const contexto = { clienteId: 'cli-1', leadId: 'lead-1' };
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo()]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, contexto);

      const createArgs = prisma.fluxoExecucao.create.mock.calls[0][0];
      expect(createArgs.data.status).toBe('PENDENTE');
      expect(createArgs.data.contexto).toMatchObject(contexto);
    });
  });

  // -------------------------------------------------------------------------
  // dispararDireto
  // -------------------------------------------------------------------------

  describe('dispararDireto', () => {
    it('enfileira job diretamente para execução e nó informados', async () => {
      await service.dispararDireto('exec-1', 'no-1');

      expect(queue.add).toHaveBeenCalledWith(
        'step',
        { execucaoId: 'exec-1', noId: 'no-1' },
        expect.any(Object),
      );
    });

    it('usa número de tentativas customizado quando passado', async () => {
      await service.dispararDireto('exec-1', 'no-1', { tentativas: 5 });

      const opts = queue.add.mock.calls[0][2];
      expect(opts.attempts).toBe(5);
    });

    it('usa tentativas padrão=3 quando não passado', async () => {
      await service.dispararDireto('exec-1', 'no-1');

      const opts = queue.add.mock.calls[0][2];
      expect(opts.attempts).toBe(3);
    });
  });
});
