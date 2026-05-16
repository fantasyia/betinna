import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { EnvService } from '@config/env.service';
import { CAMPANHA_ENVIO_QUEUE } from '@modules/campanhas/campanha-envio.types';
import { FLUXO_QUEUE } from '@modules/fluxos/fluxo-executor.types';
import { DEAD_LETTER_QUEUE } from '@modules/dead-letter/dead-letter.types';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';

interface DependencyCheck {
  status: 'ok' | 'down' | 'degraded';
  latencyMs: number;
  error?: string | null;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
    @InjectQueue(CAMPANHA_ENVIO_QUEUE) private readonly campanhaQueue: Queue,
    @InjectQueue(FLUXO_QUEUE) private readonly fluxoQueue: Queue,
    @InjectQueue(DEAD_LETTER_QUEUE) private readonly dlQueue: Queue,
  ) {}

  /**
   * Liveness — endpoint público leve (sem dependências externas).
   * Usado por Docker healthcheck + Kubernetes liveness probe.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness — sempre retorna ok se processo está vivo' })
  liveness(): { status: string; timestamp: string; uptime: number } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  /**
   * Deep check — DB + Redis + BullMQ queues. Restrito a ADMIN.
   * Retorna 503 se qualquer dependência crítica está down.
   *
   * Usado por:
   *  - Monitoramento externo (UptimeRobot, Pingdom)
   *  - Kubernetes readiness probe
   *  - Pre-deploy validation
   */
  @Roles('ADMIN')
  @Get('deep')
  @ApiOperation({ summary: 'Deep health check (ADMIN only) — DB + Redis + BullMQ' })
  async deep(): Promise<{
    status: 'ok' | 'degraded';
    timestamp: string;
    uptime: number;
    env: string;
    checks: {
      database: DependencyCheck;
      redis: DependencyCheck;
      bullmq: DependencyCheck & { queues?: Record<string, number> };
    };
  }> {
    const [db, redis, queues] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkBullMq(),
    ]);

    const overallStatus: 'ok' | 'degraded' =
      db.status === 'ok' && redis.status === 'ok' && queues.status === 'ok'
        ? 'ok'
        : 'degraded';

    const payload = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      env: this.env.get('NODE_ENV'),
      checks: { database: db, redis, bullmq: queues },
    };

    if (overallStatus !== 'ok') {
      // 503 + payload sinalizando o que está degradado
      throw new HttpException(payload, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return payload;
  }

  // ─── Checks individuais ─────────────────────────────────────────────────

  private async checkDatabase(): Promise<DependencyCheck> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', latencyMs: Date.now() - started };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async checkRedis(): Promise<DependencyCheck> {
    const started = Date.now();
    try {
      // PING via ioredis — barato e direto
      const result = await this.redis.client.ping();
      const ok = result === 'PONG';
      return {
        status: ok ? 'ok' : 'down',
        latencyMs: Date.now() - started,
        error: ok ? null : `Resposta inesperada: ${result}`,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async checkBullMq(): Promise<
    DependencyCheck & { queues?: Record<string, number> }
  > {
    const started = Date.now();
    try {
      // Para cada queue, conta jobs ativos+waiting. Se BullMQ responder, tá OK.
      const queues = [
        { name: CAMPANHA_ENVIO_QUEUE, q: this.campanhaQueue },
        { name: FLUXO_QUEUE, q: this.fluxoQueue },
        { name: DEAD_LETTER_QUEUE, q: this.dlQueue },
      ];
      const counts: Record<string, number> = {};
      for (const { name, q } of queues) {
        const c = await q.getJobCounts('active', 'waiting', 'delayed');
        counts[name] = (c.active ?? 0) + (c.waiting ?? 0) + (c.delayed ?? 0);
      }
      return {
        status: 'ok',
        latencyMs: Date.now() - started,
        queues: counts,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
