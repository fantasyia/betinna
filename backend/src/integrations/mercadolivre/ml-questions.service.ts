import { Injectable, Logger } from '@nestjs/common';
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
