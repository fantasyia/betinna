import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EnvService } from '@config/env.service';
import { RedisService } from '@database/redis.service';
import {
  ForbiddenException,
  UnauthorizedException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { AuthGuard } from './guards/auth.guard';

/**
 * Refresh Token Reuse Detection (Sprint 3 FIX 2).
 *
 * O **Supabase Auth gerencia rotation** de refresh tokens nativamente:
 *  - Cada chamada em `supabase.auth.refreshSession()` emite um NOVO refresh token
 *  - O antigo é marcado como `revoked_at` no banco do Supabase
 *  - Se alguém usar o token revoked, Supabase retorna 401 (token_revoked)
 *
 * **O que nosso backend faz aqui:**
 *  1. Track de qual `refreshTokenId` (sha256) está atualmente válido por usuário
 *  2. Se uma chamada usar um ID que NÃO é o atual → indica token reuse →
 *     forçamos logout de TODAS as sessões do user (invalidando cache do AuthGuard)
 *  3. Adicionalmente, expomos `signOut` que limpa o cache e marca o refresh
 *     atual como inválido
 *
 * Como Supabase já cobre rotation, este service é uma CAMADA EXTRA de detecção
 * pra cenários onde o frontend (intencionalmente ou por bug) reusa tokens.
 *
 * **Frontend deve:**
 *  - Armazenar refresh token em cookie httpOnly + SameSite=Strict + Secure
 *  - NUNCA expor refresh token em localStorage/sessionStorage
 *  - Chamar `supabase.auth.refreshSession()` ANTES do access token expirar
 *  - Em 401 de refresh, fazer signOut completo (limpar cookie)
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    env: EnvService,
  ) {
    // TTL típico do refresh token Supabase = 7 dias
    this.ttlSeconds = 60 * 60 * 24 * 7;
  }

  /**
   * Marca um refresh token como o ATUAL deste usuário.
   * Chame após cada refresh bem-sucedido.
   *
   * @param userId  Subject do JWT
   * @param refreshToken  Token novo retornado pelo Supabase (NUNCA armazenamos o token cru — só o hash)
   */
  async markCurrent(userId: string, refreshToken: string): Promise<void> {
    const tokenId = this.tokenId(refreshToken);
    const key = `auth:refresh:current:${userId}`;
    await this.redis.setEx(key, tokenId, this.ttlSeconds);
  }

  /**
   * Verifica se um refresh token apresentado é o ATUAL.
   * Se não for, lança Forbidden + invalida toda a sessão (token reuse detection).
   *
   * @returns true se OK; lança exception se reuse detectado
   */
  async assertCurrent(userId: string, refreshToken: string): Promise<true> {
    const presented = this.tokenId(refreshToken);
    const key = `auth:refresh:current:${userId}`;
    let current: string | null;
    try {
      current = await this.redis.get(key);
    } catch (err) {
      // Redis fora — log e prossegue (fail-open neste caso porque Supabase já
      // tem rotation própria; nosso check é defesa em profundidade)
      this.logger.warn(
        `Redis offline em assertCurrent: ${err instanceof Error ? err.message : err}. Prosseguindo.`,
      );
      return true;
    }
    if (current === null) {
      // Primeira vez ou expirou — aceita e marca
      await this.markCurrent(userId, refreshToken);
      return true;
    }
    if (current !== presented) {
      // TOKEN REUSE: um token antigo foi apresentado. Invalida TUDO.
      this.logger.error(
        `Token reuse detectado para userId=${userId} — invalidando todas as sessões`,
      );
      await this.invalidateAllSessions(userId);
      throw new ForbiddenException(
        'Token reuse detectado — todas as sessões foram invalidadas',
        ErrorCode.AUTH_INVALID_TOKEN,
      );
    }
    return true;
  }

  /**
   * Logout explícito — invalida cache do AuthGuard + remove refresh tracking.
   * Cliente deve TAMBÉM chamar `supabase.auth.signOut()` no frontend.
   */
  async signOut(user: AuthenticatedUser): Promise<void> {
    await this.invalidateAllSessions(user.id);
    this.logger.log(`Sign-out: userId=${user.id}`);
  }

  /**
   * Invalida cache do AuthGuard + refresh tracking de um user.
   * Próximas requisições com qualquer token atual vão ter que carregar o user
   * fresh do DB (e podem falhar se Supabase já revogou).
   */
  private async invalidateAllSessions(userId: string): Promise<void> {
    await Promise.all([
      AuthGuard.invalidate(this.redis, userId).catch(() => {
        /* já invalidado */
      }),
      this.redis.del(`auth:refresh:current:${userId}`).catch(() => {
        /* já não existe */
      }),
    ]);
  }

  /** SHA-256 hex truncado pra 32 chars — id estável sem armazenar token cru. */
  private tokenId(refreshToken: string): string {
    return createHash('sha256').update(refreshToken, 'utf8').digest('hex').slice(0, 32);
  }
}
