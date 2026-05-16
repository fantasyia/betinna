import { Global, Module } from '@nestjs/common';
import { CronLockService } from './cron-lock.service';
import { IdempotencyService } from './idempotency.service';
import { SequenceService } from './sequence.service';
import { WebhookAntiReplayService } from './webhook-anti-replay.service';

/**
 * Utilities globais (Redis-backed) usadas por crons, processors e services.
 * - CronLockService: lock distribuído para crons em multi-replica
 * - IdempotencyService: SETNX para envios externos (anti-duplicação em retry)
 * - SequenceService: numeração atômica por empresa+tipo
 * - WebhookAntiReplayService: timestamp window + signature dedup (Sprint 3)
 *
 * RedisService vem de PrismaModule (global) — não precisa importar aqui.
 */
@Global()
@Module({
  providers: [CronLockService, IdempotencyService, SequenceService, WebhookAntiReplayService],
  exports: [CronLockService, IdempotencyService, SequenceService, WebhookAntiReplayService],
})
export class SharedUtilsModule {}
