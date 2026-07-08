import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@database/redis.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { AuthGuard } from './guards/auth.guard';

/**
 * Invalidação de sessão no logout.
 *
 * Limpa o cache do AuthGuard (e os rastros de refresh no Redis) pra que a próxima requisição
 * recarregue o user fresh do DB. Usado pelo logout legado (`POST /auth/logout`).
 *
 * NOTA (2026-07-08): a **detecção de reuse de refresh token** (endpoint `POST /auth/refresh-track`
 * + rotação atômica via Lua) foi REMOVIDA — nunca teve caller no frontend (o fluxo de auth D47 é
 * cookie httpOnly gerenciado pelo backend, e o Supabase Auth já faz rotation de refresh nativamente).
 * Era defesa-em-profundidade inativa. Sobrou só a invalidação de sessão do logout.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Logout explícito — invalida cache do AuthGuard + remove os rastros de refresh do user.
   * Cliente deve TAMBÉM chamar `supabase.auth.signOut()` no frontend.
   */
  async signOut(user: AuthenticatedUser): Promise<void> {
    await this.invalidateAllSessions(user.id);
    this.logger.log(`Sign-out: userId=${user.id}`);
  }

  /**
   * Invalida cache do AuthGuard + remove as chaves de refresh de um user.
   * Próximas requisições carregam o user fresh do DB (e podem falhar se o Supabase já revogou).
   */
  private async invalidateAllSessions(userId: string): Promise<void> {
    await Promise.all([
      AuthGuard.invalidate(this.redis, userId).catch(() => {
        /* já invalidado */
      }),
      this.redis
        .del(`auth:refresh:current:${userId}`, `auth:refresh:previous:${userId}`)
        .catch(() => {
          /* já não existe */
        }),
    ]);
  }
}
