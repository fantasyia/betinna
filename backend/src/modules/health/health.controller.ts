import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
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
   *
   * CRÍTICO @SkipThrottle: o /health é chamado a cada ~5s pelo Railway
   * healthcheck. Sem @SkipThrottle, cada chamada passa pelo
   * TenantThrottlerGuard global que faz INCR no Redis — se o Redis está
   * com latência alta (ex: passando por REDIS_PUBLIC_URL proxy), cada
   * /health demora segundos. Excede o timeout do Railway → deploy fica
   * "Unhealthy". Hotpatch 2026-05-20.
   *
   * Filosofia: liveness DEVE ser instantâneo. Sem auth, sem throttle,
   * sem DB, sem Redis. Só process.uptime() — síncrono, microssegundos.
   */
  @SkipThrottle()
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
  @ApiOperation({
    summary: 'Deep health (ADMIN only) — DB + Redis + BullMQ + Supabase + integrações ativas',
  })
  async deep(): Promise<{
    status: 'ok' | 'degraded';
    timestamp: string;
    uptime: number;
    env: string;
    checks: {
      database: DependencyCheck;
      redis: DependencyCheck;
      bullmq: DependencyCheck & { queues?: Record<string, number> };
      supabase: DependencyCheck;
      integracoes: DependencyCheck & { conectadas?: Record<string, number> };
    };
  }> {
    const [db, redis, queues, supabase, integracoes] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkBullMq(),
      this.checkSupabase(),
      this.checkIntegracoes(),
    ]);

    // supabase + integracoes são `degraded` aceitável (não bloqueia liveness)
    const criticalOk = db.status === 'ok' && redis.status === 'ok' && queues.status === 'ok';
    const overallStatus: 'ok' | 'degraded' =
      criticalOk && supabase.status !== 'down' ? 'ok' : 'degraded';

    const payload = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      env: this.env.get('NODE_ENV'),
      checks: { database: db, redis, bullmq: queues, supabase, integracoes },
    };

    if (overallStatus !== 'ok') {
      // 503 + payload sinalizando o que está degradado
      throw new HttpException(payload, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return payload;
  }

  /**
   * Supabase Auth liveness — ping `/auth/v1/health` (endpoint público).
   * Usa fetch direto pra não puxar SDK pesado.
   */
  private async checkSupabase(): Promise<DependencyCheck> {
    const started = Date.now();
    const supabaseUrl = this.env.get('SUPABASE_URL');
    if (!supabaseUrl) {
      return { status: 'down', latencyMs: 0, error: 'SUPABASE_URL não configurado' };
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return {
        status: res.ok ? 'ok' : 'degraded',
        latencyMs: Date.now() - started,
        error: res.ok ? null : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Integrações — conta conexões ATIVAS por serviço. Não chama APIs externas
   * (rate limit + custo). Só uma fotografia do estado registrado no DB.
   *
   * Status:
   *  - 'ok' se há ≥ 1 integração conectada
   *  - 'degraded' se nenhuma (cliente pode não ter setado nada — não é erro)
   */
  private async checkIntegracoes(): Promise<
    DependencyCheck & { conectadas?: Record<string, number> }
  > {
    const started = Date.now();
    try {
      const conectadas = await this.prisma.integracaoConexao.groupBy({
        by: ['servico'],
        where: { ativo: true },
        _count: true,
      });
      type GbRow = { servico: string; _count: number };
      const rows = conectadas as unknown as GbRow[];
      const total = rows.reduce((s, c) => s + (c._count ?? 0), 0);
      const porServico: Record<string, number> = {};
      for (const c of rows) porServico[c.servico] = c._count ?? 0;
      return {
        status: total > 0 ? 'ok' : 'degraded',
        latencyMs: Date.now() - started,
        conectadas: porServico,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
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

  /**
   * Endpoint de teste manual do Sentry — ADMIN-only.
   *
   * Lança uma exceção crua que deve ser capturada pelo Sentry via
   * AllExceptionsFilter (5xx). Use pra validar que a captura backend está
   * funcionando end-to-end:
   *
   *   curl -X GET https://<host>/api/v1/health/__sentry_test \
   *     -H "Authorization: Bearer <admin-token>"
   *
   * Resposta esperada: 500 do AllExceptionsFilter + evento aparecendo no
   * dashboard Sentry com tag `path=/health/__sentry_test`.
   */
  @Roles('ADMIN')
  @Get('__sentry_test')
  @ApiOperation({ summary: 'Force throw para testar Sentry (ADMIN only)' })
  async sentryTest(): Promise<never> {
    throw new Error(`Sentry test from backend — ${new Date().toISOString()}`);
  }

  private async checkBullMq(): Promise<DependencyCheck & { queues?: Record<string, number> }> {
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
