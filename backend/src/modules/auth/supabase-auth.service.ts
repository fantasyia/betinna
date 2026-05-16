import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { EnvService } from '@config/env.service';
import {
  ForbiddenException,
  UnauthorizedException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import {
  isValidJwtPayload,
  type SupabaseJwtPayload,
} from '@shared/types/jwt-payload';

/**
 * Valida JWTs emitidos pelo Supabase Auth.
 *
 * O Supabase emite tokens assinados HS256 com o JWT secret do projeto,
 * E TAMBÉM tokens RS256 quando configurado JWKS. Suportamos os dois.
 */
@Injectable()
export class SupabaseAuthService {
  private readonly logger = new Logger(SupabaseAuthService.name);
  private readonly hsSecret?: Uint8Array;
  private readonly jwksClient?: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  constructor(private readonly env: EnvService) {
    this.issuer = `${this.env.get('SUPABASE_URL')}/auth/v1`;
    const secret = this.env.get('SUPABASE_JWT_SECRET');
    if (secret && secret.length > 0) {
      this.hsSecret = new TextEncoder().encode(secret);
    }
    // Endpoint JWKS público do Supabase Auth
    const jwksUrl = new URL(`${this.issuer}/.well-known/jwks.json`);
    this.jwksClient = createRemoteJWKSet(jwksUrl, {
      cacheMaxAge: 60 * 60 * 1000, // 1h
    });
  }

  /**
   * Verifica um Bearer JWT do Supabase.
   *
   * Auditoria 2026-05-15 P0: o payload retornado é **read-only para `sub`**.
   * Demais campos sensíveis (`empresaId`, `role`) NUNCA são lidos do JWT —
   * sempre buscados no DB via `AuthGuard.loadUser(sub)`.
   *
   * Retorna `SupabaseJwtPayload` validado (com `sub` garantidamente presente).
   * Lança UnauthorizedException quando inválido/expirado.
   */
  async verifyToken(token: string): Promise<SupabaseJwtPayload> {
    if (!token || token.length < 20) {
      throw new UnauthorizedException('Token ausente ou malformado', ErrorCode.AUTH_INVALID_TOKEN);
    }

    try {
      // Tenta HS256 primeiro se temos o secret (mais comum em projetos Supabase)
      if (this.hsSecret) {
        const { payload } = await jwtVerify(token, this.hsSecret, {
          issuer: this.issuer,
        });
        if (!isValidJwtPayload(payload)) {
          throw new UnauthorizedException('Token sem subject', ErrorCode.AUTH_INVALID_TOKEN);
        }
        return payload;
      }

      // Fallback: RS256 via JWKS (planos Pro+ do Supabase)
      if (this.jwksClient) {
        const { payload } = await jwtVerify(token, this.jwksClient, {
          issuer: this.issuer,
        });
        if (!isValidJwtPayload(payload)) {
          throw new UnauthorizedException('Token sem subject', ErrorCode.AUTH_INVALID_TOKEN);
        }
        return payload;
      }

      throw new ForbiddenException(
        'SUPABASE_JWT_SECRET não configurado',
        ErrorCode.AUTH_INVALID_TOKEN,
      );
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Token inválido';
      this.logger.debug(`Falha verificando JWT: ${message}`);
      if (message.toLowerCase().includes('exp')) {
        throw new UnauthorizedException('Token expirado', ErrorCode.AUTH_EXPIRED_TOKEN);
      }
      throw new UnauthorizedException('Token inválido', ErrorCode.AUTH_INVALID_TOKEN);
    }
  }
}
