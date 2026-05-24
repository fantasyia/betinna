import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { EnvService } from '@config/env.service';
import { BusinessRuleException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

/**
 * CatalogShareService — gera e valida tokens JWT pra links públicos
 * de catálogo do REP.
 *
 * Antes desta correção: URL era placeholder `/catalogo/share/<repId>/<clienteId>`
 * — qualquer um que adivinhasse repId+clienteId poderia acessar.
 *
 * Agora: URL é `/catalogo/share/<token>` onde `token` é um JWT HS256 assinado
 * pelo backend com:
 *  - `sub` = repId (catálogo do dono)
 *  - `cid` = clienteId (cliente alvo, pra rastreabilidade)
 *  - `exp` = agora + TTL (default 7 dias, configurável)
 *  - `iat` = emitido em
 *
 * Secret derivado da `ENCRYPTION_KEY` via SHA256 (isolamento — comprometer
 * o token não vaza ENCRYPTION_KEY direto). Mesmo padrão do D14 (Google OAuth state).
 *
 * Endpoint público `GET /catalogo/share/:token` valida + decodifica + retorna
 * preview do catálogo. Sem auth.
 */

const TTL_DEFAULT_SECONDS = 60 * 60 * 24 * 7; // 7 dias

export interface SharePayload {
  /** ID do REP dono do catálogo */
  repId: string;
  /** ID do cliente pra quem foi compartilhado (opcional — share livre sem vínculo) */
  clienteId?: string;
  /** ID da empresa (multi-tenant scope) */
  empresaId: string;
}

@Injectable()
export class CatalogShareService {
  private readonly logger = new Logger(CatalogShareService.name);
  private readonly secret: Uint8Array;
  private readonly ttlSeconds: number;

  constructor(env: EnvService) {
    const encryptionKey = env.get('ENCRYPTION_KEY');
    // Derivação isolada: comprometer este JWT não vaza ENCRYPTION_KEY raw.
    const derivedKey = createHash('sha256')
      .update(encryptionKey)
      .update('catalog-share-token')
      .digest();
    this.secret = new Uint8Array(derivedKey);
    this.ttlSeconds =
      parseInt(process.env.CATALOG_SHARE_TTL_SECONDS ?? '', 10) || TTL_DEFAULT_SECONDS;
  }

  /**
   * Gera token assinado com TTL. Default 7 dias, override por env.
   */
  async gerar(payload: SharePayload): Promise<string> {
    // `cid` é opcional — só inclui no JWT se houver clienteId.
    // Token sem `cid` = share "livre" (sem cliente vinculado).
    const claims: Record<string, string> = {
      sub: payload.repId,
      eid: payload.empresaId,
    };
    if (payload.clienteId) claims.cid = payload.clienteId;
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.secret);
  }

  /**
   * Valida token. Lança UnauthorizedException se inválido/expirado.
   */
  async validar(token: string): Promise<SharePayload> {
    try {
      const { payload } = await jwtVerify(token, this.secret);
      const repId = typeof payload.sub === 'string' ? payload.sub : null;
      const empresaId = typeof payload.eid === 'string' ? payload.eid : null;
      // cid é opcional — token sem clienteId é share "livre" (sem vínculo).
      const clienteId = typeof payload.cid === 'string' ? payload.cid : undefined;
      if (!repId || !empresaId) {
        throw new BusinessRuleException('Token de compartilhamento mal formado');
      }
      return { repId, clienteId, empresaId };
    } catch (err) {
      // jose lança JOSEError em casos: expirado, assinatura inválida, formato bad
      this.logger.warn(
        `Token de share inválido: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException(
        'Link expirado ou inválido. Peça um novo link ao representante.',
        ErrorCode.AUTH_INVALID_TOKEN,
      );
    }
  }
}
