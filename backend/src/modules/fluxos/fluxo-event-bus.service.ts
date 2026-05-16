import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { FluxoTriggerTipo, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { FLUXO_QUEUE, type FluxoStepJobData } from './fluxo-executor.types';

const toJsonInput = (v: Record<string, unknown>): Prisma.InputJsonObject =>
  v as unknown as Prisma.InputJsonObject;

/**
 * FluxoEventBusService — ponte entre domínio e BullMQ.
 *
 * Uso: outros serviços injetam este bus e chamam `disparar(...)` quando
 * um evento ocorre (lead criado, pedido aprovado, etc).
 *
 * O bus:
 * 1. Localiza fluxos ATIVOS da empresa para o triggerTipo.
 * 2. Para cada fluxo, cria uma `FluxoExecucao` no banco.
 * 3. Enfileira o job BullMQ para o nó TRIGGER de cada fluxo.
 *
 * Falha silenciosa por design: erro no bus não derruba a operação principal.
 */
@Injectable()
export class FluxoEventBusService {
  private readonly logger = new Logger(FluxoEventBusService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(FLUXO_QUEUE) private readonly queue: Queue<FluxoStepJobData>,
  ) {}

  /**
   * Dispara o bus para um evento.
   *
   * @param empresaId  ID da empresa (multi-tenant)
   * @param triggerTipo  Tipo do evento (ex: LEAD_CRIADO)
   * @param contexto  Dados do evento passados pra execução (clienteId, pedidoId, etc.)
   */
  async disparar(
    empresaId: string,
    triggerTipo: FluxoTriggerTipo,
    contexto: Record<string, unknown>,
  ): Promise<void> {
    try {
      // Busca fluxos ATIVOS para este triggerTipo
      const fluxos = await this.prisma.fluxo.findMany({
        where: { empresaId, status: 'ATIVO', triggerTipo },
        include: {
          nos: {
            where: { tipo: 'TRIGGER' },
            select: { id: true },
          },
        },
      });

      if (fluxos.length === 0) return;

      this.logger.debug(
        `FluxoEventBus: ${triggerTipo} em empresa ${empresaId} → ${fluxos.length} fluxo(s)`,
      );

      for (const fluxo of fluxos) {
        const triggerNo = fluxo.nos[0];
        if (!triggerNo) {
          this.logger.warn(`Fluxo ${fluxo.id} (${fluxo.nome}) sem nó TRIGGER — ignorado`);
          continue;
        }

        // Cria registro da execução
        const execucao = await this.prisma.fluxoExecucao.create({
          data: {
            fluxoId: fluxo.id,
            empresaId,
            status: 'PENDENTE',
            contexto: toJsonInput(contexto),
          },
        });

        // Enfileira job para o nó trigger
        const job = await this.queue.add(
          'step',
          { execucaoId: execucao.id, noId: triggerNo.id },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { count: 500 },
            removeOnFail: { count: 200 },
          },
        );

        // Salva jobId pra monitoramento
        await this.prisma.fluxoExecucao.update({
          where: { id: execucao.id },
          data: { jobId: job.id },
        });

        this.logger.log(
          `Fluxo "${fluxo.nome}" (${fluxo.id}): execução ${execucao.id} enfileirada (job ${job.id})`,
        );
      }
    } catch (err) {
      // Falha no bus não derruba a operação principal
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`FluxoEventBus.disparar(${triggerTipo}) falhou: ${msg}`, err);
    }
  }

  /**
   * Enfileira diretamente um job para uma execução já criada (usado em testes manuais).
   */
  async dispararDireto(
    execucaoId: string,
    noId: string,
    opts: { tentativas?: number } = {},
  ): Promise<void> {
    await this.queue.add(
      'step',
      { execucaoId, noId },
      {
        attempts: opts.tentativas ?? 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
  }
}
