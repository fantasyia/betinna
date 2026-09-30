import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { MLRespostaIaService, TAG_HUMANO } from './ml-resposta-ia.service';

/** Trava por pergunta: a sincronização de 10 min reentrega a mesma pergunta. */
const TTL_TRAVA_S = 15 * 60;

/**
 * Resposta AUTOMÁTICA das perguntas de anúncio do ML (Léo, 30/09).
 *
 * Mesma regra do botão "Sugerir com IA": responde só o que está no anúncio
 * (dados, respostas anteriores do vendedor e, se precisar, a descrição); sem a
 * informação, NÃO responde e a pergunta fica marcada "humano".
 *
 * ⚠️ Chave PRÓPRIA, separada do bot do WhatsApp (Léo, 30/09): liga e desliga em
 * `Empresa.config.mercadoLivre.respostaAutomatica`. Desligada por padrão — nada
 * de bot/persona/botLigado do WhatsApp entra aqui.
 *
 * Uma tentativa por pergunta: pergunta com resposta (mesmo que falha) ou já
 * marcada "humano" é pulada. Falha no envio marca "humano" — nunca fica em
 * loop tentando a cada sincronização.
 */
@Injectable()
export class MLRespostaAutomaticaService {
  private readonly logger = new Logger(MLRespostaAutomaticaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly inbox: InboxService,
    private readonly respostaIa: MLRespostaIaService,
  ) {}

  /** A empresa ligou a resposta automática do ML? (padrão: não) */
  async ligada(empresaId: string): Promise<boolean> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const cfg = (e?.config ?? {}) as { mercadoLivre?: { respostaAutomatica?: boolean | null } };
    return cfg.mercadoLivre?.respostaAutomatica === true;
  }

  /**
   * Tenta responder sozinha a pergunta desta conversa. Nunca lança: é chamada
   * em segundo plano pela chegada da pergunta (webhook e sincronização).
   */
  async talvezResponder(
    empresaId: string,
    conversationId: string,
    statusPergunta: string,
  ): Promise<'respondida' | 'humano' | 'pulada'> {
    try {
      if (statusPergunta !== 'UNANSWERED') return 'pulada';
      if (!(await this.ligada(empresaId))) return 'pulada';

      const conv = await this.prisma.conversation.findFirst({
        where: { id: conversationId, empresaId, canal: 'MARKETPLACE_ML' },
        select: {
          peerId: true,
          tagsInternas: true,
          mensagens: { where: { direction: 'OUTBOUND' }, select: { id: true }, take: 1 },
        },
      });
      if (!conv || !conv.peerId.startsWith('q:')) return 'pulada';
      if (conv.mensagens.length > 0) return 'pulada';
      if (conv.tagsInternas.some((t) => t.toLowerCase() === TAG_HUMANO)) return 'pulada';

      const trava = await this.redis.client
        .set(`ml:auto:${conversationId}`, '1', 'EX', TTL_TRAVA_S, 'NX')
        .catch(() => 'OK');
      if (trava !== 'OK') return 'pulada';

      const r = await this.respostaIa.sugerirPorConversa(empresaId, conversationId);
      // sem a informação: a sugestão já marcou "humano"
      if (!r.texto) return 'humano';

      try {
        await this.inbox.responderComoBot(conversationId, r.texto, `ml-auto:${conversationId}`);
        return 'respondida';
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Resposta automática ML falhou (conv=${conversationId}): ${m}`);
        await this.respostaIa.marcarParaHumano(conversationId);
        return 'humano';
      }
    } catch (err) {
      // sem chave da OpenAI, ML fora do ar etc.: a pergunta segue aberta pro humano
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Resposta automática ML não rodou (conv=${conversationId}): ${m}`);
      return 'pulada';
    }
  }
}
