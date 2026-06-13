import { Injectable, Logger, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import { THROTTLE_PER_USER } from '@shared/decorators/throttle-per-user.decorator';

interface RequestComUser {
  user?: { id?: string; empresaIdAtiva?: string | null };
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * TenantThrottlerGuard — extensão do throttler default que usa `empresaId`
 * (multi-tenant) + IP como chave de rate limit ao invés de só IP.
 *
 * Por quê? Throttler default usa IP — se vários tenants estiverem atrás
 * de NAT/proxy compartilhado (raro mas possível em redes corporativas),
 * um tenant pode esgotar a quota e bloquear os outros.
 *
 * Usar empresaId resolve isso. Quando user não tem empresaIdAtiva (rotas
 * públicas /health, /webhooks), cai pro IP — comportamento default.
 *
 * Ativação seletiva: a app continua usando ThrottlerGuard global. Pra usar
 * este, aplicar `@UseGuards(TenantThrottlerGuard)` em controllers
 * específicos onde isolamento per-tenant importa (ex: /pedidos, /relatorios,
 * /mullerbot — endpoints com cálculo pesado por tenant).
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  private readonly customLogger = new Logger(TenantThrottlerGuard.name);
  // Avoid log spam quando Redis está down — uma mensagem a cada 30s
  private lastStorageErrorLog = 0;

  protected async getTracker(req: RequestComUser, context?: ExecutionContext): Promise<string> {
    // Rotas marcadas com @ThrottlePerUser usam o user.id como chave — recursos
    // POR-USUÁRIO (ex: WhatsApp pessoal do rep). Sem isso, o bucket por-tenant faria
    // um rep esgotar a cota de toda a empresa (o recurso é user_<id>, não o número central).
    if (context && req.user?.id) {
      const perUser = this.reflector.getAllAndOverride<boolean>(THROTTLE_PER_USER, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (perUser) return `user:${req.user.id}`;
    }
    const empresaId = req.user?.empresaIdAtiva;
    if (empresaId) {
      return `tenant:${empresaId}`;
    }
    // Fallback: IP REAL resolvido pelo Express com `trust proxy=1` (main.ts).
    // NUNCA usar o `x-forwarded-for` CRU como chave: o cliente forja esse header
    // e, trocando-o a cada tentativa, ganhava um bucket novo de rate-limit por
    // request — burlando o limite de login (10/15min) num brute force. `req.ip`
    // já respeita só o hop de proxy confiável (Railway), então é à prova de forja.
    return req.ip || 'unknown';
  }

  /**
   * Override do handleRequest pra fail-open quando storage (Redis) está
   * fora.
   *
   * Hotpatch 2026-05-20: quando o Redis backing-store fica unreachable
   * (ETIMEDOUT no `INCR` que conta requests), o `super.handleRequest`
   * lançava exceção em CADA request — incluindo `/api/v1/health`. Isso
   * fazia o healthcheck do Railway nunca passar mesmo com o app rodando.
   *
   * Decisão: prefere DISPONIBILIDADE sobre PROTEÇÃO. Em outage transiente
   * do Redis, deixa todo tráfego passar (sem rate limit) em vez de
   * retornar 500/timeout. Operador é notificado via Sentry + logs.
   */
  protected async handleRequest(req: ThrottlerRequest): Promise<boolean> {
    try {
      return await super.handleRequest(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Detecta erro de storage (Redis down) — fail-open.
      // Outros erros (lógica do throttler, config) ainda propagam.
      const isStorageError =
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('Connection is closed');

      if (isStorageError) {
        const now = Date.now();
        if (now - this.lastStorageErrorLog > 30_000) {
          this.customLogger.warn(
            `Throttler storage indisponível (${msg}) — fail-open ativo, requests passam sem rate limit.`,
          );
          this.lastStorageErrorLog = now;
        }
        return true; // fail-open: deixa request passar
      }
      throw err;
    }
  }
}
