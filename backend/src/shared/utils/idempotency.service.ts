import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@database/redis.service';

/**
 * Idempotência via Redis SETNX.
 *
 * Para operações com side-effect externo (envio de WhatsApp, email, push pro
 * OMIE), evita duplicação em retry de jobs ou disparos concorrentes.
 *
 * Fluxo:
 *  1. Antes do side-effect: `claim(key, ttl)` — se já existe, skip
 *  2. Executa o side-effect
 *  3. Em caso de falha após executar, mantém a chave (key persiste como prova
 *     que o efeito já aconteceu — retry seguro)
 *
 * Para REVERSO (cancelar idempotência se falhou ANTES do side-effect),
 * use `release(key)`.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Tenta reservar a chave. Retorna true se claim foi bem-sucedido (operação
   * deve prosseguir); false se já foi processada (skip seguro).
   *
   * TTL default 86400s (24h) — suficiente para retries de jobs longos.
   */
  async claim(key: string, ttlSeconds = 86_400): Promise<boolean> {
    try {
      return await this.redis.setNxEx(key, '1', ttlSeconds);
    } catch (err) {
      // Se Redis está fora, preferimos NÃO enviar duplicado — bail
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Idempotency claim falhou em ${key}: ${msg} — bail`);
      return false;
    }
  }

  /**
   * Como claim(), mas PROPAGA o erro de Redis em vez de devolver false. Use quando
   * "Redis indisponível" NÃO pode ser confundido com "já processado": senão o caller
   * pula o envio e marca como enviado sem ter enviado (perda silenciosa). O erro deve
   * FALHAR o job (retry/dead-letter), não virar skip-sucesso.
   * Retorna true = reservado (siga); false = chave já existe (skip seguro).
   */
  async claimStrict(key: string, ttlSeconds = 86_400): Promise<boolean> {
    return this.redis.setNxEx(key, '1', ttlSeconds);
  }

  /** Verifica se a chave já está reservada (sem fazer claim). */
  async exists(key: string): Promise<boolean> {
    const v = await this.redis.get(key).catch(() => null);
    return v !== null;
  }

  /**
   * Remove o claim — use quando o side-effect FALHOU antes de ser executado
   * (assim um retry pode tentar de novo).
   */
  async release(key: string): Promise<void> {
    await this.redis.del(key).catch(() => {
      /* ignora */
    });
  }
}
