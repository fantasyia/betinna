import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '@database/redis.service';
import type { MullerBotResposta } from './mullerbot.types';

/**
 * MullerBotCacheService — duas camadas Redis:
 *
 * 1) **Cache de respostas** (`mb:answer:<hash>` → JSON da resposta)
 *    - Chave: SHA-256 de empresaId + modelo + pergunta normalizada + produtos
 *      participantes. Mudou catálogo → cache invalida automaticamente.
 *    - TTL configurável (default 1h). Reduz custo OpenAI em perguntas
 *      repetitivas (FAQ commercial, "qual o preço do X?").
 *    - Skip via `semCache=true` no DTO.
 *
 * 2) **Histórico conversacional** (`mb:hist:<userId>:<sessionId>` → LIST JSON)
 *    - Mantém últimas N mensagens (config `MULLERBOT_HISTORY_TURNS`).
 *    - Cada turn é um par user+assistant.
 *    - TTL renovado a cada interação (default 1h). Inativa expira sozinha.
 *
 * Falha do Redis é silenciosa: cache miss vira chamada OpenAI normal,
 * histórico vazio vira stateless. Best-effort — não derruba a feature.
 */

export interface HistoricoMsg {
  role: 'user' | 'assistant';
  content: string;
  at: number; // epoch ms
}

const RESP_TTL_SECONDS = 60 * 60; // 1h
const HIST_TTL_SECONDS = 60 * 60; // 1h sliding
const HIST_MAX_TURNS = 4; // 4 turns = 8 mensagens (user+assistant)

@Injectable()
export class MullerBotCacheService {
  private readonly logger = new Logger(MullerBotCacheService.name);
  private readonly respTtl: number;
  private readonly histTtl: number;
  private readonly histMaxTurns: number;

  constructor(private readonly redis: RedisService) {
    // Configuráveis se o env tiver — senão defaults
    this.respTtl = this.parseEnvInt('MULLERBOT_CACHE_TTL_SECONDS', RESP_TTL_SECONDS);
    this.histTtl = this.parseEnvInt('MULLERBOT_HISTORY_TTL_SECONDS', HIST_TTL_SECONDS);
    this.histMaxTurns = this.parseEnvInt('MULLERBOT_HISTORY_TURNS', HIST_MAX_TURNS);
  }

  private parseEnvInt(key: string, fallback: number): number {
    try {
      const raw = process.env[key];
      if (!raw) return fallback;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    } catch {
      return fallback;
    }
  }

  // ─── Cache de respostas ──────────────────────────────────────────────

  /**
   * Computa chave determinística pra cache de resposta.
   * Sensível a: empresaId, modelo, pergunta normalizada, IDs dos produtos
   * que foram incluídos (mudou catálogo → cache invalida).
   */
  buildAnswerKey(params: {
    empresaId: string;
    modelo: string;
    pergunta: string;
    produtoIds: string[];
  }): string {
    const norm = params.pergunta.trim().toLowerCase().replace(/\s+/g, ' ');
    const produtos = [...params.produtoIds].sort().join(',');
    const raw = `${params.empresaId}|${params.modelo}|${norm}|${produtos}`;
    const hash = createHash('sha256').update(raw).digest('hex').slice(0, 32);
    return `mb:answer:${hash}`;
  }

  async getAnswer(key: string): Promise<MullerBotResposta | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as MullerBotResposta;
      return { ...parsed, cacheHit: true };
    } catch (err) {
      this.logger.warn(
        `Falha lendo cache MullerBot: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async setAnswer(key: string, resposta: MullerBotResposta): Promise<void> {
    try {
      // Não armazena flag `cacheHit` no cache

      const { cacheHit: _cacheHit, ...sanitized } = resposta;
      await this.redis.setEx(key, JSON.stringify(sanitized), this.respTtl);
    } catch (err) {
      this.logger.warn(
        `Falha gravando cache MullerBot: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ─── Histórico conversacional ────────────────────────────────────────

  private histKey(userId: string, sessionId: string): string {
    // sessionId já validado por Zod (max 64 chars). Sanitiza por segurança.
    const safe = sessionId.replace(/[^\w-]/g, '_').slice(0, 64);
    return `mb:hist:${userId}:${safe}`;
  }

  /** Retorna histórico mais recente (até `histMaxTurns * 2` mensagens). */
  async getHistorico(userId: string, sessionId: string): Promise<HistoricoMsg[]> {
    try {
      const raw = await this.redis.get(this.histKey(userId, sessionId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as HistoricoMsg[];
      return Array.isArray(parsed) ? parsed.slice(-this.histMaxTurns * 2) : [];
    } catch (err) {
      this.logger.warn(
        `Falha lendo histórico MullerBot: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Adiciona par user+assistant ao histórico. Mantém apenas últimas N turns.
   * TTL é renovado em cada gravação (sliding window).
   */
  async pushTurn(
    userId: string,
    sessionId: string,
    userMsg: string,
    assistantMsg: string,
  ): Promise<void> {
    try {
      const atual = await this.getHistorico(userId, sessionId);
      const now = Date.now();
      const novo: HistoricoMsg[] = [
        ...atual,
        { role: 'user' as const, content: userMsg, at: now },
        { role: 'assistant' as const, content: assistantMsg, at: now },
      ].slice(-this.histMaxTurns * 2);

      await this.redis.setEx(this.histKey(userId, sessionId), JSON.stringify(novo), this.histTtl);
    } catch (err) {
      this.logger.warn(
        `Falha gravando histórico MullerBot: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async limparHistorico(userId: string, sessionId: string): Promise<{ ok: true }> {
    try {
      await this.redis.del(this.histKey(userId, sessionId));
    } catch (err) {
      this.logger.warn(
        `Falha limpando histórico MullerBot: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { ok: true };
  }
}
