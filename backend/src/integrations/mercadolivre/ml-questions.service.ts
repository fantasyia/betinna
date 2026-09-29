import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { MLClientService } from './ml-client.service';
import type { MLQuestion } from './ml.types';

/**
 * Perguntas pré-venda do Mercado Livre.
 *
 * Fluxo:
 *  - Webhook topic=questions → buscar pergunta → InboxService cria/atualiza
 *    Conversation(categoria=PRE_VENDA) + Message INBOUND com referência ao
 *    item_id e seller_id em metadata
 *  - Resposta: POST /answers com text + question_id
 *
 * Peer ID na Inbox: `pergunta:<question_id>` — cada pergunta vira uma Conversation
 * separada (modelo do ML — não há thread). Isso bate com a UX do próprio ML.
 */
@Injectable()
export class MLQuestionsService {
  private readonly logger = new Logger(MLQuestionsService.name);

  constructor(
    private readonly ml: MLClientService,
    private readonly inbox: InboxService,
    private readonly prisma: PrismaService,
  ) {}

  /** Busca pergunta pelo ID. */
  async obter(empresaId: string, questionId: string | number): Promise<MLQuestion> {
    return this.ml.get<MLQuestion>(empresaId, `/questions/${questionId}`);
  }

  /**
   * Processa uma pergunta recebida via webhook ou sync. Cria/atualiza
   * Conversation + Message na Inbox.
   */
  async processarQuestion(empresaId: string, q: MLQuestion): Promise<void> {
    // Cada pergunta = 1 Conversation (não há thread). peerId combina item+question.
    const peerId = `q:${q.id}`;
    const peerNome = `Comprador ML #${q.from.id}`;

    await this.inbox.processarMensagemEntrante({
      empresaId,
      canal: 'MARKETPLACE_ML',
      peerId,
      peerNome,
      tipo: 'TEXT',
      conteudo: q.text,
      externalId: `q:${q.id}`,
      data: new Date(q.date_created),
      meta: {
        ml_question_id: q.id,
        ml_item_id: q.item_id,
        ml_seller_id: q.seller_id,
        ml_buyer_id: q.from.id,
        ml_status: q.status,
        ml_origem: 'question',
        categoria: 'PRE_VENDA',
      },
    });
  }

  /** Responde uma pergunta. */
  async responder(
    empresaId: string,
    questionId: string | number,
    texto: string,
  ): Promise<{ externalId: string }> {
    const r = await this.ml.post<{ id: number }>(empresaId, `/answers`, {
      question_id: Number(questionId),
      text: texto,
    });
    return { externalId: `a:${r.id}` };
  }

  /**
   * Status de cada anúncio (`active`, `paused`, `closed`, `under_review`…), pelo
   * multiget do ML — 20 ids por chamada, que é o limite da API. Anúncio que o
   * ML não devolve fica fora do mapa (quem chama decide o que fazer).
   */
  async statusDosAnuncios(empresaId: string, itemIds: string[]): Promise<Map<string, string>> {
    const unicos = [...new Set(itemIds.filter(Boolean))];
    const mapa = new Map<string, string>();
    for (let i = 0; i < unicos.length; i += 20) {
      const lote = unicos.slice(i, i + 20);
      const r = await this.ml.get<Array<{ code: number; body?: { id?: string; status?: string } }>>(
        empresaId,
        `/items?ids=${lote.join(',')}&attributes=id,status`,
      );
      for (const it of r ?? []) {
        if (it.code === 200 && it.body?.id && it.body.status) mapa.set(it.body.id, it.body.status);
      }
    }
    return mapa;
  }

  /**
   * Importa as perguntas pendentes — SÓ as de anúncio ATIVO (Léo, 29/09).
   *
   * A busca por `status=UNANSWERED` devolve pergunta de anúncio pausado e
   * encerrado também: na conta LGHB vieram 18, e o painel do ML mostra 3 "a
   * responder" (ele só conta anúncio ativo). Pergunta de anúncio inativo não
   * entra, e a conversa que já tinha entrado é ARQUIVADA — nada é apagado.
   *
   * Se o status não puder ser consultado, importa tudo como antes: esconder
   * pergunta de cliente por falha de consulta é pior que mostrar a mais.
   */
  async sincronizarPendentes(
    empresaId: string,
    sellerId: string,
  ): Promise<{ importadas: number; arquivadas: number; porStatus: Record<string, number> }> {
    const qs = await this.listarNaoRespondidas(empresaId, sellerId);
    let status: Map<string, string> | null = null;
    try {
      status = await this.statusDosAnuncios(
        empresaId,
        qs.map((q) => String(q.item_id)),
      );
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Status dos anúncios indisponível (empresa=${empresaId}) — importando todas: ${m}`,
      );
    }
    const porStatus: Record<string, number> = {};
    let importadas = 0;
    let arquivadas = 0;
    for (const q of qs) {
      const st = status?.get(String(q.item_id));
      porStatus[st ?? 'desconhecido'] = (porStatus[st ?? 'desconhecido'] ?? 0) + 1;
      // Sem status (consulta falhou ou o ML não devolveu o anúncio) = importa.
      if (!st || st === 'active') {
        await this.processarQuestion(empresaId, q);
        importadas++;
        continue;
      }
      const r = await this.prisma.conversation.updateMany({
        where: {
          empresaId,
          canal: 'MARKETPLACE_ML',
          peerId: `q:${q.id}`,
          status: { not: 'ARQUIVADA' },
        },
        data: { status: 'ARQUIVADA', tagsInternas: { push: 'ml-anuncio-inativo' } },
      });
      arquivadas += r.count;
    }
    return { importadas, arquivadas, porStatus };
  }

  /**
   * Busca perguntas não respondidas — usado pelo cron de fallback
   * (caso o webhook tenha falhado).
   */
  async listarNaoRespondidas(
    empresaId: string,
    sellerId: string,
    limit = 50,
  ): Promise<MLQuestion[]> {
    const params = new URLSearchParams({
      seller_id: sellerId,
      status: 'UNANSWERED',
      limit: String(limit),
      api_version: '4',
    });
    const r = await this.ml.get<{ questions: MLQuestion[] }>(
      empresaId,
      `/questions/search?${params}`,
    );
    return r.questions ?? [];
  }
}
