import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { EnvService } from '@config/env.service';
import { UnauthorizedException } from '@shared/errors/app-exception';
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
      //
      // Hardening sprint 2026-05-16 (CRIT-2 + ALTA-1):
      // - `audience: 'authenticated'`: Supabase emite tokens com aud="authenticated";
      //   sem checar isso, qualquer JWT do mesmo project (service_role, etc) passaria.
      // - `algorithms: ['HS256']`: algorithm pinning explícito. Evita confusion attack
      //   se header `alg` for forjado pra algo inesperado.
      // - `clockTolerance: '30s'`: tolerância pra clock skew entre Supabase e Railway
      //   (MED-1) — evita rejeição falsa de tokens recém-emitidos.
      if (this.hsSecret) {
        const { payload } = await jwtVerify(token, this.hsSecret, {
          issuer: this.issuer,
          audience: 'authenticated',
          algorithms: ['HS256'],
          clockTolerance: '30s',
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
          audience: 'authenticated',
          algorithms: ['RS256'],
          clockTolerance: '30s',
        });
        if (!isValidJwtPayload(payload)) {
          throw new UnauthorizedException('Token sem subject', ErrorCode.AUTH_INVALID_TOKEN);
        }
        return payload;
      }

      // Configuração faltando — issue de deployment, não de auth. 503 (Service Unavailable)
      // seria mais correto que 403; usamos UnauthorizedException com mensagem clara
      // por compatibilidade com o resto do sistema (frontend reage a 401 redirecionando).
      this.logger.error(
        'Nem SUPABASE_JWT_SECRET nem JWKS disponíveis — auth completamente desativada',
      );
      throw new UnauthorizedException(
        'Servidor de autenticação não configurado',
        ErrorCode.AUTH_INVALID_TOKEN,
      );
    } catch (error) {
      if (error instanceof UnauthorizedException) {
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
