/**
 * Worker entry point — para Railway "Worker" service.
 *
 * Sprint 4 FIX 4: separa background processing (BullMQ workers + cron schedulers)
 * do HTTP API. Railway escala cada um independentemente.
 *
 * Quando rodando como Worker:
 *  - NÃO inicia HTTP server (sem Express, sem listen)
 *  - Mantém BullMQ workers vivos consumindo as queues (campanha-envio, fluxo, dead-letter)
 *  - Mantém cron schedulers ativos (comissoes, omie-sync, etc.)
 *  - O `CronLockService` (Redis SETNX) garante que apenas UM processo executa
 *    cada cron — então rodar crons em ambos API + Worker é seguro, mas
 *    convencionamos que Worker é o "owner" canônico.
 *
 * Como rodar:
 *   Production:  node dist/worker
 *   Development: tsx watch src/worker.ts
 *
 * Como Railway distingue:
 *   - API service:    startCommand = "npm run start:prod"
 *   - Worker service: startCommand = "npm run worker"
 *
 * SERVICE_TYPE env var:
 *   - Set as "worker" no Railway Worker service (informativo, para logs)
 *   - Set as "api" no Railway API service (default quando undefined)
 */
import 'reflect-metadata';
// Sentry inicializado ANTES de qualquer import (mesma regra do main.ts)
import { initSentry } from '@shared/observability/sentry';
initSentry();

import { NestFactory } from '@nestjs/core';
import { Logger as NestLogger } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new NestLogger('Worker');

  // createApplicationContext: NÃO inicia HTTP server, mas inicializa todos
  // os providers (BullMQ workers, ScheduleModule, services).
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  // Usa Pino global como nos outros serviços
  app.useLogger(app.get(PinoLogger));

  // Graceful shutdown — Railway envia SIGTERM em redeploys
  app.enableShutdownHooks();

  const serviceType = process.env.SERVICE_TYPE ?? 'worker';
  logger.log(
    `🛠️  Betinna.ai Worker rodando · SERVICE_TYPE=${serviceType} · PID=${process.pid}`,
  );
  logger.log(
    `   BullMQ queues ativas (campanha-envio, fluxo-execucao, dead-letter)`,
  );
  logger.log(
    `   Cron schedulers ativos — CronLockService garante singleton via Redis`,
  );

  // Mantém o processo vivo. Sinais de shutdown são tratados por enableShutdownHooks.
  // Sem app.listen() — Worker não escuta porta.
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha fatal no bootstrap do Worker:', err);
  process.exit(1);
});
