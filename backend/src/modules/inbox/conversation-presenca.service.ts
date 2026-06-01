import { Injectable } from '@nestjs/common';
import { RedisService } from '@database/redis.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { InboxService } from './inbox.service';

interface PresencaEntry {
  nome: string;
  ts: number;
}

/**
 * #25 — "Trava" de 2 atendentes (presença ao vivo, baseada em Redis).
 *
 * Não é um lock rígido (não bloqueia o envio) — é AWARENESS: enquanto um
 * atendente está com a conversa aberta, ele bate um heartbeat; outros que
 * abrirem a mesma conversa veem "Fulano está atendendo" e o front confirma
 * antes de responder em duplicidade. Presença é efêmera → Redis com TTL,
 * sem tocar no banco.
 */
@Injectable()
export class ConversationPresencaService {
  /** Chave expira se ninguém der heartbeat nesse tempo. */
  private static readonly TTL_S = 90;
  /** Entrada é considerada "saiu" se o último heartbeat foi há mais que isso. */
  private static readonly STALE_MS = 45_000;

  constructor(
    private readonly redis: RedisService,
    private readonly inbox: InboxService,
  ) {}

  private chave(conversationId: string): string {
    return `inbox:presenca:${conversationId}`;
  }

  /**
   * Registra/renova a presença do usuário na conversa e retorna QUEM MAIS está
   * com ela aberta agora (exceto o próprio e entradas velhas).
   */
  async heartbeat(
    user: AuthenticatedUser,
    conversationId: string,
  ): Promise<{ outros: Array<{ id: string; nome: string }> }> {
    await this.inbox.findById(user, conversationId); // valida acesso (lança se fora de escopo)
    const agora = Date.now();
    const mapa = await this.ler(conversationId);

    for (const [uid, entry] of Object.entries(mapa)) {
      if (agora - entry.ts > ConversationPresencaService.STALE_MS) delete mapa[uid];
    }
    mapa[user.id] = { nome: user.nome, ts: agora };

    await this.redis
      .setEx(this.chave(conversationId), JSON.stringify(mapa), ConversationPresencaService.TTL_S)
      .catch(() => undefined);

    const outros = Object.entries(mapa)
      .filter(([uid]) => uid !== user.id)
      .map(([id, entry]) => ({ id, nome: entry.nome }));
    return { outros };
  }

  /** Remove a própria presença ao sair da conversa (best-effort). */
  async sair(user: AuthenticatedUser, conversationId: string): Promise<{ ok: true }> {
    const mapa = await this.ler(conversationId);
    if (mapa[user.id]) {
      delete mapa[user.id];
      if (Object.keys(mapa).length === 0) {
        await this.redis.del(this.chave(conversationId)).catch(() => undefined);
      } else {
        await this.redis
          .setEx(
            this.chave(conversationId),
            JSON.stringify(mapa),
            ConversationPresencaService.TTL_S,
          )
          .catch(() => undefined);
      }
    }
    return { ok: true };
  }

  private async ler(conversationId: string): Promise<Record<string, PresencaEntry>> {
    const raw = await this.redis.get(this.chave(conversationId)).catch(() => null);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, PresencaEntry>;
    } catch {
      return {};
    }
  }
}
