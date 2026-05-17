import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';

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
  protected async getTracker(req: RequestComUser): Promise<string> {
    const empresaId = req.user?.empresaIdAtiva;
    if (empresaId) {
      return `tenant:${empresaId}`;
    }
    // Fallback: IP (mesmo do ThrottlerGuard parent)
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    return ip;
  }

  // Quando a app envolve ThrottlerGuard via APP_GUARD, este método override
  // serve só pra ser chamado quando @UseGuards explicit. A versão default
  // do parent invoca getTracker dentro do handle().
  protected async handleRequest(req: ThrottlerRequest): Promise<boolean> {
    return super.handleRequest(req);
  }
}
