import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { EnvService } from '@config/env.service';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { isValidJwtPayload, type SupabaseJwtPayload } from '@shared/types/jwt-payload';

/**
 * Valida JWTs emitidos pelo Supabase Auth.
 *
 * **Auto-detecção de algoritmo (sprint 2026-05-17, fix login-railway-401):**
 * o Supabase emite tokens HS256 em projetos antigos e RS256 em projetos novos
 * (default a partir de 2025). Antes esta classe escolhia HS256 quando havia
 * `SUPABASE_JWT_SECRET`, mas isso rejeitava todo token RS256 (algorithm pinning).
 * Agora lemos o header `alg` do JWT e roteamos pro caminho certo. Resultado:
 * mesmo projeto pode coexistir entre algos sem reconfigurar.
 *
 * Falhas de verificação são logadas com o reason específico (iss/aud/alg/exp)
 * pra debug rápido. Em produção (Railway) os logs estruturados Pino expõem isso.
 */
@Injectable()
export class SupabaseAuthService {
  private readonly logger = new Logger(SupabaseAuthService.name);
  private readonly hsSecret?: Uint8Array;
  private readonly jwksClient?: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  /** Issuer alternativo (mesma URL com/sem trailing slash) — tolera divergências config. */
  private readonly issuerVariants: string[];

  constructor(private readonly env: EnvService) {
    const supabaseUrl = this.env.get('SUPABASE_URL').replace(/\/$/, '');
    this.issuer = `${supabaseUrl}/auth/v1`;
    this.issuerVariants = [this.issuer, `${this.issuer}/`];

    const secret = this.env.get('SUPABASE_JWT_SECRET');
    if (secret && secret.length > 0) {
      this.hsSecret = new TextEncoder().encode(secret);
    }

    // Endpoint JWKS público do Supabase Auth — funciona em todos os planos
    // a partir de 2024, é o método default para projetos novos.
    try {
      const jwksUrl = new URL(`${this.issuer}/.well-known/jwks.json`);
      this.jwksClient = createRemoteJWKSet(jwksUrl, {
        cacheMaxAge: 60 * 60 * 1000, // 1h
        cooldownDuration: 30_000, // 30s entre fetches se JWK não encontrada
      });
    } catch (err) {
      this.logger.error(
        `Falha criando JWKS client para ${this.issuer}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Health-check de boot: avisa explicitamente se a config é insuficiente.
    if (!this.hsSecret && !this.jwksClient) {
      this.logger.error(
        '⚠️  Nenhum método de verificação JWT disponível! ' +
          'Configure SUPABASE_JWT_SECRET no Railway (Settings → Variables) ou ' +
          'garanta que SUPABASE_URL está correto pra JWKS funcionar.',
      );
    } else {
      this.logger.log(
        `Auth configurada: HS256=${!!this.hsSecret} JWKS=${!!this.jwksClient} issuer=${this.issuer}`,
      );
    }
  }

  /**
   * Verifica um Bearer JWT do Supabase.
   *
   * Auditoria 2026-05-15 P0: o payload retornado é **read-only para `sub`**.
   * Demais campos sensíveis (`empresaId`, `role`) NUNCA são lidos do JWT —
   * sempre buscados no DB via `AuthGuard.loadUser(sub)`.
   *
   * Auto-detecta HS256 vs RS256 lendo o header `alg`. Tolera issuer com/sem
   * trailing slash. Loga reason específico de falha em logger.debug.
   *
   * Retorna `SupabaseJwtPayload` validado (com `sub` garantidamente presente).
   * Lança UnauthorizedException quando inválido/expirado.
   */
  async verifyToken(token: string): Promise<SupabaseJwtPayload> {
    if (!token || token.length < 20) {
      throw new UnauthorizedException('Token ausente ou malformado', ErrorCode.AUTH_INVALID_TOKEN);
    }

    // Auto-detecção: lê o header sem verificar pra saber qual alg usar.
    let alg: string | undefined;
    try {
      const header = decodeProtectedHeader(token);
      alg = header.alg;
    } catch {
      throw new UnauthorizedException('Token malformado', ErrorCode.AUTH_INVALID_TOKEN);
    }

    try {
      if (alg === 'HS256') {
        if (!this.hsSecret) {
          this.logger.warn(
            'Token HS256 recebido mas SUPABASE_JWT_SECRET não configurado. ' +
              'Configure a variável no Railway → Settings → Variables.',
          );
          throw new UnauthorizedException(
            'Servidor não configurado para HS256',
            ErrorCode.AUTH_INVALID_TOKEN,
          );
        }
        return await this.verifyHS256(token);
      }

      if (alg === 'RS256' || alg === 'ES256') {
        if (!this.jwksClient) {
          this.logger.warn(
            `Token ${alg} recebido mas JWKS client não inicializou. Verifique SUPABASE_URL.`,
          );
          throw new UnauthorizedException(
            'Servidor não configurado para JWKS',
            ErrorCode.AUTH_INVALID_TOKEN,
          );
        }
        return await this.verifyJWKS(token, alg);
      }

      this.logger.warn(`Algorithm desconhecido no JWT: ${alg}`);
      throw new UnauthorizedException(
        `Algoritmo de token não suportado: ${alg}`,
        ErrorCode.AUTH_INVALID_TOKEN,
      );
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Token inválido';
      // Logging detalhado pra debug — em prod o Pino captura isso como evento estruturado.
      this.logger.debug(
        `Falha verificando JWT [alg=${alg ?? '?'}] [issuer=${this.issuer}]: ${message}`,
      );
      if (message.toLowerCase().includes('exp')) {
        throw new UnauthorizedException('Token expirado', ErrorCode.AUTH_EXPIRED_TOKEN);
      }
      throw new UnauthorizedException('Token inválido', ErrorCode.AUTH_INVALID_TOKEN);
    }
  }

  // ─── Caminhos internos por algoritmo ─────────────────────────────────────

  private async verifyHS256(token: string): Promise<SupabaseJwtPayload> {
    const { payload } = await jwtVerify(token, this.hsSecret as Uint8Array, {
      issuer: this.issuerVariants,
      audience: 'authenticated',
      algorithms: ['HS256'],
      clockTolerance: '30s',
    });
    if (!isValidJwtPayload(payload)) {
      throw new UnauthorizedException('Token sem subject', ErrorCode.AUTH_INVALID_TOKEN);
    }
    return payload;
  }

  private async verifyJWKS(
    token: string,
    alg: 'RS256' | 'ES256',
  ): Promise<SupabaseJwtPayload> {
    const { payload } = await jwtVerify(token, this.jwksClient!, {
      issuer: this.issuerVariants,
      audience: 'authenticated',
      algorithms: [alg],
      clockTolerance: '30s',
    });
    if (!isValidJwtPayload(payload)) {
      throw new UnauthorizedException('Token sem subject', ErrorCode.AUTH_INVALID_TOKEN);
    }
    return payload;
  }
}
