import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '@database/prisma.service';
import { DeadLetterService } from '@modules/dead-letter/dead-letter.service';
import {
  FLUXO_JOB_REDISPARO,
  FLUXO_QUEUE,
  type FluxoJobData,
  type FluxoRedisparoJobData,
  type FluxoStepJobData,
} from './fluxo-executor.types';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import { FluxoExecutorService } from './fluxo-executor.service';

/**
 * FluxoExecutorProcessor — worker BullMQ que executa um passo por vez.
 *
 * Cada job carrega `{ execucaoId, noId }` e delega ao FluxoExecutorService.
 * O próprio executor enfileira o(s) próximo(s) nó(s) após a execução.
 *
 * Concorrência: 5 jobs simultâneos — configurável via `concurrency`.
 * Retry: 3 tentativas com backoff exponencial (configurado no producer).
 */
@Processor(FLUXO_QUEUE, { concurrency: 5 })
export class FluxoExecutorProcessor extends WorkerHost {
  private readonly logger = new Logger(FluxoExecutorProcessor.name);

  constructor(
    private readonly executor: FluxoExecutorService,
    private readonly prisma: PrismaService,
    private readonly deadLetter: DeadLetterService,
    private readonly bus: FluxoEventBusService,
  ) {
    super();
  }

  async process(job: Job<FluxoJobData>): Promise<void> {
    // Re-disparo de gatilho proativo que foi adiado por turno de IA aberto na
    // conversa (ver FluxoEventBusService.reagendarProativo): republica o MESMO
    // evento no bus. Se a conversa ainda estiver ocupada, o próprio guard adia
    // de novo — até o teto.
    if (job.name === FLUXO_JOB_REDISPARO) {
      const { empresaId, triggerTipo, contexto } = job.data as FluxoRedisparoJobData;
      this.logger.log(`Job ${job.id}: re-disparo de ${triggerTipo} (empresa ${empresaId})`);
      await this.bus.disparar(empresaId, triggerTipo, contexto);
      return;
    }
    const { execucaoId, noId } = job.data as FluxoStepJobData;
    this.logger.debug(
      `Job ${job.id}: exec=${execucaoId} no=${noId} (tentativa ${job.attemptsMade + 1})`,
    );
    // job.id é a chave do claim de idempotência (estável no retry, fresco por enqueue).
    // `attemptsMade + 1` = qual tentativa é esta. O executor precisa disso pra
    // saber se ainda há retry curto pela frente (relança) ou se é hora do
    // reagendamento longo — WhatsApp fora do ar não volta em 8 segundos.
    await this.executor.executarPasso(execucaoId, noId, job.id!, job.attemptsMade + 1);
  }

  /**
   * Sprint 3 FIX 3: dead-letter on final failure.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<FluxoJobData>, err: Error): Promise<void> {
    const attempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < attempts) return;

    // Re-disparo não tem execução pra marcar (o evento nem virou execução
    // ainda) — vai direto pro dead-letter.
    if (job.name === FLUXO_JOB_REDISPARO) {
      await this.deadLetter.record({ originalQueue: FLUXO_QUEUE, originalJob: job, error: err });
      return;
    }
    const dados = job.data as FluxoStepJobData;

    // Falha FINAL: marca a execução como FALHOU. Sem isso ela ficava EM_EXECUCAO
    // pra sempre e o anti-reabertura do MENSAGEM_CANAL bloqueava a conversa
    // definitivamente. updateMany + filtro de status: não derruba AGUARDANDO
    // (timeout próprio) nem CONCLUIDO/CANCELADO; antes do dead-letter e em
    // try/catch próprio pra uma falha não impedir a outra.
    try {
      await this.prisma.fluxoExecucao.updateMany({
        where: { id: dados.execucaoId, status: { in: ['PENDENTE', 'EM_EXECUCAO'] } },
        data: {
          status: 'FALHOU',
          terminouEm: new Date(),
          erroMsg: `Passo ${dados.noId} esgotou ${attempts} tentativas: ${err.message}`,
        },
      });
    } catch (markErr) {
      this.logger.error(
        `Falha ao marcar execução ${dados.execucaoId} como FALHOU: ${String(markErr)}`,
      );
    }

    // Enriquece com empresaId via FluxoExecucao
    let empresaId: string | undefined;
    try {
      const exec = await this.prisma.fluxoExecucao.findUnique({
        where: { id: dados.execucaoId },
        select: { empresaId: true },
      });
      empresaId = exec?.empresaId;
    } catch {
      /* fica undefined */
    }
    if (empresaId) {
      (job.data as unknown as Record<string, unknown>).empresaId = empresaId;
    }
    await this.deadLetter.record({
      originalQueue: FLUXO_QUEUE,
      originalJob: job,
      error: err,
    });
  }
}
