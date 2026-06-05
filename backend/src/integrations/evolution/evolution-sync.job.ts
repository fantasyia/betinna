import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { EvolutionInboundService } from './evolution-inbound.service';

/**
 * Poll de **fallback** do Evolution (padrão D28 — webhook perde evento quando o
 * socket oscila). A cada minuto puxa as mensagens recentes de cada instância e
 * reprocessa idempotente (dedup por externalId). Garante que mensagem nenhuma
 * fique presa só no banco do Evolution sem chegar na Inbox.
 *
 * Só roda quando WHATSAPP_PROVIDER=evolution. Lock distribuído (50s) faz UM só
 * processo (api OU worker) puxar por minuto, mesmo os dois carregando o módulo.
 */
@Injectable()
export class EvolutionSyncJob {
  private readonly logger = new Logger(EvolutionSyncJob.name);

  constructor(
    private readonly inbound: EvolutionInboundService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'evolution-poll-fallback' })
  async puxarRecentes(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (this.env.get('WHATSAPP_PROVIDER') !== 'evolution') return;
    // Lock 50s < intervalo 60s → só um processo puxa por minuto.
    if (!(await this.cronLock.acquire('evolution-poll-fallback', 50))) return;
    try {
      await this.inbound.sincronizarRecentes();
    } catch (err) {
      this.logger.warn(
        `[evolution] poll fallback falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
