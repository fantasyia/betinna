import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '@database/redis.service';
import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { EnvService } from '@config/env.service';
import {
  BusinessRuleException,
  ForbiddenException,
  UnauthorizedException,
} from '@shared/errors/app-exception';
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

  constructor(
    env: EnvService,
    private readonly redis: RedisService,
  ) {
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

  /** TTL máximo (global) — o rep pode encurtar, nunca esticar. */
  get ttlMaximoSegundos(): number {
    return this.ttlSeconds;
  }

  /**
   * Gera token assinado com TTL. Default 7 dias (ou o da env), e o caller pode
   * pedir um TTL MENOR (validade escolhida pelo rep no share).
   */
  async gerar(payload: SharePayload, ttlSegundos?: number): Promise<string> {
    const ttl = Math.min(Math.max(1, Math.floor(ttlSegundos ?? this.ttlSeconds)), this.ttlSeconds);
    // `cid` é opcional — só inclui no JWT se houver clienteId.
    // Token sem `cid` = share "livre" (sem cliente vinculado).
    const claims: Record<string, string> = {
      sub: payload.repId,
      eid: payload.empresaId,
    };
    if (payload.clienteId) claims.cid = payload.clienteId;
    // AUDITORIA (média): sem identificador, um link vazado só morria pelo TTL (até
    // 7 dias) — não havia como cortar UM link sem desativar o rep inteiro. `jti`
    // dá o gancho da revogação (ver `revogar`).
    const jti = randomUUID();
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .sign(this.secret);
  }

  /**
   * Revoga UM link específico (o `jti` do token). Marca fica no Redis com TTL
   * igual ao que resta do token — depois disso ele expira sozinho.
   */
  async revogar(token: string): Promise<void> {
    const { payload } = await jwtVerify(token, this.secret).catch(() => ({ payload: null }));
    const jti = typeof payload?.jti === 'string' ? payload.jti : null;
    if (!jti) return;
    const exp = typeof payload?.exp === 'number' ? payload.exp : 0;
    const restam = Math.max(60, Math.ceil(exp - Date.now() / 1000) + 60);
    await this.redis.setEx(`share:revogado:${jti}`, '1', restam).catch(() => undefined);
    this.logger.log(`Link de catálogo revogado (jti ${jti})`);
  }

  /**
   * Revogação pedida por um usuário logado (#74).
   *
   * O `revogar` existia mas NENHUM endpoint chamava — na prática o gancho de
   * revogação era decorativo: um link vazado no WhatsApp do cliente seguia
   * aberto até o TTL de 7 dias e não havia como cortar. Aqui entra o gate de
   * dono: o REP só derruba link do próprio catálogo; ADMIN/DIRECTOR/GERENTE
   * derrubam qualquer link da própria empresa.
   */
  async revogarComoUsuario(
    user: { id: string; role: string; empresaIdAtiva?: string | null },
    token: string,
  ): Promise<{ ok: true }> {
    const { payload } = await jwtVerify(token, this.secret).catch(() => ({ payload: null }));
    if (!payload) {
      throw new UnauthorizedException('Link inválido ou já expirado', ErrorCode.AUTH_INVALID_TOKEN);
    }
    const dono = typeof payload.sub === 'string' ? payload.sub : null;
    const empresaId = typeof payload.eid === 'string' ? payload.eid : null;
    if (!empresaId || empresaId !== user.empresaIdAtiva) {
      throw new ForbiddenException('Link de outra empresa');
    }
    const podeQualquer = ['ADMIN', 'DIRECTOR', 'GERENTE'].includes(user.role);
    if (!podeQualquer && dono !== user.id) {
      throw new ForbiddenException('Só o representante dono do catálogo pode revogar este link');
    }
    await this.revogar(token);
    return { ok: true };
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
      // Revogação: token com jti marcado não vale mais, mesmo dentro do TTL.
      // Fail-OPEN se o Redis cair — preferir o link funcionando a derrubar o
      // catálogo de todos os reps por causa de uma indisponibilidade.
      const jti = typeof payload.jti === 'string' ? payload.jti : null;
      if (jti) {
        const revogado = await this.redis.get(`share:revogado:${jti}`).catch(() => null);
        if (revogado) {
          throw new BusinessRuleException('Link revogado pelo representante');
        }
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
