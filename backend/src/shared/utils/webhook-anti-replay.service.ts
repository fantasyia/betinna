import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '@database/redis.service';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

/**
 * Janela máxima entre o `timestamp` do webhook e `now`.
 * Eventos mais antigos = replay; rejeita com 400.
 *
 * 5 minutos cobre drift de clock + latência de retry (Meta tenta até 8x em 24h,
 * mas cada tentativa tem timestamp fresco — não confundir com replay).
 */
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

/**
 * TTL do registro de assinatura no Redis.
 * 10min > 5min de skew → garante que se o webhook chegar atrasado dentro da
 * janela, ainda vamos detectar replay subsequente.
 */
const SIGNATURE_TTL_SECONDS = 10 * 60;

export type WebhookProvider =
  | 'omie'
  | 'meta'
  | 'shopee'
  | 'tiktok'
  | 'mercadolivre'
  | 'iugu';

export interface AntiReplayResult {
  /** true = primeira vez vendo essa assinatura, prosseguir com processamento */
  fresh: boolean;
  /** Hash interno (sha256) da signature, pra debug. */
  signatureHash: string;
}

/**
 * Anti-replay para webhooks (Sprint 3 FIX 1).
 *
 * Estratégia:
 *  1. Cada webhook que carrega `timestamp` (header ou body) é verificado contra
 *     a janela de skew. Se mais velho que 5min → rejeita com 401 (`Webhook expired`).
 *  2. A assinatura (HMAC ou bytes que provam autenticidade) é hashed e armazenada
 *     no Redis com TTL 10min. Mesmo signature dentro da janela = replay → acknowledge
 *     idempotente sem reprocessar.
 *
 * Provedores que **não enviam timestamp** (caso do Mercado Livre — não tem HMAC):
 *  - Replay-protection via signature funciona ainda, mas atacante pode escolher
 *    qualquer signature ainda válida → fallback obrigatório no IP whitelist (Sprint 1).
 *
 * Idempotência VS anti-replay:
 *  - Idempotência (já implementada via `externalId` em Message/Incident) protege
 *    contra duplo processamento mesmo de retries LEGÍTIMOS.
 *  - Anti-replay protege contra um atacante reapresentando uma request HMAC válida.
 *  - Os dois trabalham juntos.
 */
@Injectable()
export class WebhookAntiReplayService {
  private readonly logger = new Logger(WebhookAntiReplayService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Verifica timestamp + marca a signature como vista.
   *
   * Retorna `{ fresh: true }` quando é a primeira vez e o caller deve processar.
   * Retorna `{ fresh: false }` quando é replay (caller deve ACK sem processar).
   *
   * Lança `UnauthorizedException` quando o timestamp está fora da janela de 5min.
   */
  async checkAndMarkWebhook(
    provider: WebhookProvider,
    signature: string,
    timestamp: number | string | Date | undefined,
  ): Promise<AntiReplayResult> {
    const signatureHash = this.hashSignature(signature);

    // 1) Verificação de timestamp (quando provedor envia)
    if (timestamp !== undefined && timestamp !== null && timestamp !== '') {
      const tsMs = this.parseTimestamp(timestamp);
      if (tsMs === null) {
        this.logger.warn(
          `Webhook ${provider}: timestamp inválido (${timestamp}) — rejeitado`,
        );
        throw new UnauthorizedException(
          'Webhook timestamp inválido',
          ErrorCode.AUTH_INVALID_TOKEN,
        );
      }
      const skewMs = Math.abs(Date.now() - tsMs);
      if (skewMs > MAX_TIMESTAMP_SKEW_MS) {
        this.logger.warn(
          `Webhook ${provider}: timestamp fora da janela (skew=${Math.round(skewMs / 1000)}s) — rejeitado como replay`,
        );
        throw new UnauthorizedException(
          'Webhook expired',
          ErrorCode.AUTH_EXPIRED_TOKEN,
        );
      }
    }

    // 2) Anti-replay via Redis SETNX. Se já existe = replay
    const key = `webhook:replay:${provider}:${signatureHash}`;
    let fresh: boolean;
    try {
      fresh = await this.redis.setNxEx(key, '1', SIGNATURE_TTL_SECONDS);
    } catch (err) {
      // Redis fora → não bloqueia o webhook (degraded mode); loga e prossegue.
      this.logger.warn(
        `Redis offline em checkAndMarkWebhook ${provider}: ${err instanceof Error ? err.message : err}. Aceitando sem anti-replay.`,
      );
      return { fresh: true, signatureHash };
    }

    if (!fresh) {
      this.logger.debug(
        `Webhook ${provider} replay detectado (sig=${signatureHash.slice(0, 8)}…) — ACK sem reprocessar`,
      );
    }
    return { fresh, signatureHash };
  }

  /** SHA-256 da signature — evita armazenar a assinatura crua no Redis. */
  private hashSignature(signature: string): string {
    return createHash('sha256').update(signature, 'utf8').digest('hex');
  }

  /**
   * Aceita timestamp em vários formatos:
   *  - number: unix seconds OU unix milliseconds (heurística pelo tamanho)
   *  - string numérica: idem
   *  - string ISO 8601
   *  - Date
   */
  private parseTimestamp(t: number | string | Date): number | null {
    if (t instanceof Date) {
      const ms = t.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof t === 'number') {
      if (!Number.isFinite(t)) return null;
      // < 10^12 = segundos (Unix epoch ~10^9 até 2033)
      return t < 1e12 ? t * 1000 : t;
    }
    // string
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      return n < 1e12 ? n * 1000 : n;
    }
    const parsed = Date.parse(t);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
