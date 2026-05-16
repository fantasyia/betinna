import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EnvService } from '@config/env.service';
import { RedisService } from '@database/redis.service';
import {
  ForbiddenException,
  IntegrationException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { AuthGuard } from './guards/auth.guard';

/**
 * Refresh Token Reuse Detection.
 *
 * O **Supabase Auth gerencia rotation** de refresh tokens nativamente:
 *  - Cada chamada em `supabase.auth.refreshSession()` emite um NOVO refresh token
 *  - O antigo é marcado como `revoked_at` no banco do Supabase
 *  - Se alguém usar o token revoked, Supabase retorna 401 (token_revoked)
 *
 * **O que nosso backend faz aqui (defesa em profundidade):**
 *  1. Track de qual `refreshTokenId` (sha256) está atualmente válido por usuário
 *     E qual foi o último rotacionado (previous)
 *  2. Se uma chamada usar o `previous` → indica token reuse → invalida TODAS
 *     as sessões do usuário
 *  3. Operação CAS atômica via Lua: 2 calls concorrentes não dão race
 *
 * **Hardening 2026-05-16 (Sprint 1):**
 *  - **ALTA-2**: rotação atômica via Lua script (antes era 2 calls: assertCurrent + markCurrent)
 *  - **ALTA-3**: Redis fail-closed (era fail-open silencioso) — refresh tracking é
 *    defesa crítica, não vale a pena bypassar. Cliente recebe 503 e tenta de novo.
 *  - **Design fix**: rastreio de `previous` corrige semântica antes broken
 *    (assertCurrent rejeitava o NOVO token a cada rotação válida)
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

  /**
   * Lua script atomic rotation.
   *
   * KEYS[1] = `auth:refresh:current:<userId>`
   * KEYS[2] = `auth:refresh:previous:<userId>`
   * ARGV[1] = presented (token hash)
   * ARGV[2] = TTL em segundos
   *
   * Retorna:
   *  - "FIRST"       → não havia current; setou presented como current
   *  - "IDEMPOTENT"  → presented já era o current (re-registro inofensivo)
   *  - "ROTATED"     → presented é novo; antigo current foi pra previous
   *  - "REUSE"       → presented bate com previous → token reuse detectado
   */
  private static readonly LUA_ROTATE = `
    local current = redis.call('GET', KEYS[1])
    if not current then
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
      return 'FIRST'
    end
    if current == ARGV[1] then
      -- Renova TTL pra manter rastreio ativo enquanto sessão estiver viva
      redis.call('EXPIRE', KEYS[1], ARGV[2])
      return 'IDEMPOTENT'
    end
    local previous = redis.call('GET', KEYS[2])
    if previous == ARGV[1] then
      return 'REUSE'
    end
    redis.call('SET', KEYS[2], current, 'EX', ARGV[2])
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    return 'ROTATED'
  `;

  constructor(
    private readonly redis: RedisService,
    env: EnvService,
  ) {
    // TTL típico do refresh token Supabase = 7 dias
    this.ttlSeconds = 60 * 60 * 24 * 7;
    void env;
  }

  /**
   * Registra um refresh token, detectando reuse atomicamente.
   *
   * Substitui o par `assertCurrent + markCurrent` por uma operação CAS única
   * (resolve race condition entre tabs/dispositivos refrescando simultaneamente).
   *
   * @throws ForbiddenException se token reuse detectado (presented == previous)
   * @throws IntegrationException se Redis indisponível (fail-closed)
   */
  async registerCurrent(userId: string, refreshToken: string): Promise<void> {
    const presented = this.tokenId(refreshToken);
    const currentKey = `auth:refresh:current:${userId}`;
    const previousKey = `auth:refresh:previous:${userId}`;

    let result: unknown;
    try {
      result = await this.redis.eval(
        RefreshTokenService.LUA_ROTATE,
        [currentKey, previousKey],
        [presented, this.ttlSeconds],
      );
    } catch (err) {
      // ALTA-3: fail-CLOSED. Redis fora = não tem como rastrear reuse.
      // Cliente faz retry; logs alertam ops.
      this.logger.error(
        `Redis indisponível em registerCurrent userId=${userId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      throw new IntegrationException(
        'Refresh tracking indisponível — tente novamente em instantes',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    switch (result) {
      case 'FIRST':
      case 'IDEMPOTENT':
      case 'ROTATED':
        // OK — token aceito (primeira vez, idempotente, ou rotação válida)
        return;
      case 'REUSE':
        this.logger.error(
          `Refresh token reuse detectado userId=${userId} — invalidando sessões`,
        );
        await this.invalidateAllSessions(userId);
        throw new ForbiddenException(
          'Token reuse detectado — todas as sessões foram invalidadas',
          ErrorCode.AUTH_INVALID_TOKEN,
        );
      default:
        this.logger.error(
          `Resultado inesperado de Lua rotate: ${JSON.stringify(result)}`,
        );
        throw new IntegrationException(
          'Falha inesperada no refresh tracking',
          ErrorCode.INTEGRATION_ERROR,
        );
    }
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
      this.redis
        .del(`auth:refresh:current:${userId}`, `auth:refresh:previous:${userId}`)
        .catch(() => {
          /* já não existe */
        }),
    ]);
  }

  /** SHA-256 hex truncado pra 32 chars — id estável sem armazenar token cru. */
  private tokenId(refreshToken: string): string {
    return createHash('sha256').update(refreshToken, 'utf8').digest('hex').slice(0, 32);
  }
}
