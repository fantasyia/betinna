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
            select: { id: true, config: true },
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

        // Filtro por config do gatilho (LEAD_ETAPA_MUDOU): só dispara quando o lead
        // ENTRA na `paraEtapa` (no `funil` certo) e, se `deEtapa` setado, veio dela.
        if (triggerTipo === 'LEAD_ETAPA_MUDOU') {
          const cfg = (triggerNo.config ?? {}) as Record<string, unknown>;
          const funilCfg = cfg['funil'] as string | undefined;
          const paraEtapa = cfg['paraEtapa'] as string | undefined;
          const deEtapa = cfg['deEtapa'] as string | undefined;
          // Aceita os nomes canônicos (leads.service.moverEtapa) E os legados que os
          // disparadores internos emitem (LIBERAR_LOTE / SLA): para/deEtapaId.
          const funilCtx = contexto['funilId'] as string | undefined;
          const paraCtx = (contexto['paraFunilEtapaId'] ?? contexto['paraEtapaId']) as
            | string
            | undefined;
          const deCtx = (contexto['deFunilEtapaId'] ?? contexto['deEtapaId']) as string | undefined;
          // funilId só filtra quando o disparador informou (nem todos enviam); como
          // a etapa-destino já é única por funil, o filtro de paraEtapa cobre o resto.
          if (funilCfg && funilCtx && funilCtx !== funilCfg) continue;
          if (paraEtapa && paraCtx !== paraEtapa) continue;
          if (deEtapa && deCtx !== deEtapa) continue;
        }

        // Anti-duplicata (IA) por SUBSTITUIÇÃO: um fluxo com nó "Conversar com IA"
        // não pode ter duas execuções ativas pro MESMO lead (senão duas IAs conversam
        // em paralelo, cada uma sem o histórico da outra → re-apresenta a empresa).
        // Mas SUPRIMIR o re-disparo bloqueava a re-entrada legítima (lead volta pra
        // etapa de abordagem e o opener não disparava). Então, ao re-entrar, ENCERRAMOS
        // a(s) execução(ões) anterior(es) deste lead nesse fluxo e começamos uma NOVA —
        // re-entrar sempre dispara a abordagem, e nunca há duas em paralelo. Só vale pra
        // fluxos conversacionais (não mexe em fluxos comuns que rodam várias vezes/lead).
        const leadId = typeof contexto['leadId'] === 'string' ? contexto['leadId'] : undefined;
        if (leadId) {
          const nosIa = await this.prisma.fluxoNo.count({
            where: { fluxoId: fluxo.id, tipo: 'ACAO', acaoTipo: 'CONVERSAR_IA' },
          });
          if (nosIa > 0) {
            const { count } = await this.prisma.fluxoExecucao.updateMany({
              where: {
                fluxoId: fluxo.id,
                empresaId,
                status: { in: ['PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO'] },
                contexto: { path: ['leadId'], equals: leadId },
              },
              data: {
                status: 'CANCELADO',
                aguardandoNoId: null,
                timeoutEm: null,
                terminouEm: new Date(),
              },
            });
            if (count > 0) {
              this.logger.log(
                `Fluxo "${fluxo.nome}": ${count} execução(ões) anterior(es) do lead ${leadId} ` +
                  `encerrada(s) — re-entrada (${triggerTipo}) substitui (anti-duplicata IA)`,
              );
            }
          }
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
