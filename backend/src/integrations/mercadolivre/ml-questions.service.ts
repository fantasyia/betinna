import { Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { InboxService } from '@modules/inbox/inbox.service';
import { MLClientService } from './ml-client.service';
import { MLRespostaAutomaticaService } from './ml-resposta-automatica.service';
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
/**
 * Janela das perguntas que a sincronização importa (Léo, 29/09).
 *
 * A busca `status=UNANSWERED` devolve pergunta de MESES atrás (na conta LGHB:
 * 18, de março a setembro) e o painel do ML mostra só as recentes (3, de uma
 * semana antes). O diagnóstico mostrou que nenhum campo da API separa umas das
 * outras — nem status do anúncio (as 3 estão em anúncio pausado), nem hold,
 * nem deleted_from_listing. O que separa é a DATA. O prazo exato do painel o
 * ML não publica; 14 dias reproduz as 3 do painel naquela conta.
 *
 * Vale só pra sincronização de fallback: pergunta nova chega pelo webhook na
 * hora e sempre entra.
 */
export const PERGUNTA_ML_JANELA_DIAS = 14;

/** Só as perguntas criadas dentro da janela, contando de `agora`. */
export function perguntasRecentes<T extends { date_created: string }>(
  qs: T[],
  agora: Date = new Date(),
  dias: number = PERGUNTA_ML_JANELA_DIAS,
): T[] {
  const limite = agora.getTime() - dias * 24 * 60 * 60 * 1000;
  return qs.filter((q) => {
    const t = new Date(q.date_created).getTime();
    // data ilegível: importa (não esconder pergunta de cliente por formato)
    return Number.isNaN(t) || t >= limite;
  });
}

@Injectable()
export class MLQuestionsService {
  private readonly logger = new Logger(MLQuestionsService.name);

  constructor(
    private readonly ml: MLClientService,
    private readonly inbox: InboxService,
    @Optional() private readonly auto?: MLRespostaAutomaticaService,
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

    const r = await this.inbox.processarMensagemEntrante({
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

    // Resposta automática (chave própria do ML, desligada por padrão). Em
    // segundo plano: a IA leva segundos e o webhook do ML espera resposta rápida.
    if (this.auto && r?.conversationId) {
      void this.auto.talvezResponder(empresaId, r.conversationId, q.status);
    }
  }

  /**
   * Responde uma pergunta.
   *
   * O ML recusa resposta em anúncio que não está ativo (`not_active_item`,
   * "Item must be active") — aconteceu com o Léo em 29/09 e a tela mostrou o
   * JSON cru. Vira mensagem que diz o que fazer.
   */
  async responder(
    empresaId: string,
    questionId: string | number,
    texto: string,
  ): Promise<{ externalId: string }> {
    try {
      const r = await this.ml.post<{ id: number }>(empresaId, `/answers`, {
        question_id: Number(questionId),
        text: texto,
      });
      return { externalId: `a:${r.id}` };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (/not_active_item|Item must be active/i.test(m)) {
        throw new BusinessRuleException(
          'O Mercado Livre só aceita resposta com o anúncio ativo. Reative o anúncio e tente de novo.',
        );
      }
      throw err;
    }
  }

  /**
   * Status de cada anúncio (`active`, `paused`, `closed`…), pelo multiget do ML
   * — 20 ids por chamada (limite da API). Anúncio que o ML não devolve fica
   * fora do mapa.
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
   * Perguntas pendentes que a sincronização importa (Léo, 29/09): dos últimos
   * 14 dias E de anúncio ATIVO. Pergunta de anúncio pausado não tem como ser
   * respondida (o ML recusa), então não entra. Se o status não puder ser
   * consultado, entram todas as recentes — esconder pergunta de cliente por
   * falha de consulta é pior que mostrar a mais.
   */
  async pendentesParaImportar(
    empresaId: string,
    sellerId: string,
  ): Promise<{ importar: MLQuestion[]; foraDaJanela: number; anuncioInativo: number }> {
    const todas = await this.listarNaoRespondidas(empresaId, sellerId);
    const recentes = perguntasRecentes(todas);
    let status: Map<string, string> | null = null;
    try {
      status = await this.statusDosAnuncios(
        empresaId,
        recentes.map((q) => String(q.item_id)),
      );
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Status dos anúncios indisponível (empresa=${empresaId}): ${m}`);
    }
    const importar = recentes.filter((q) => {
      const st = status?.get(String(q.item_id));
      return !st || st === 'active';
    });
    return {
      importar,
      foraDaJanela: todas.length - recentes.length,
      anuncioInativo: recentes.length - importar.length,
    };
  }

  /**
   * DIAGNÓSTICO (29/09, só leitura): por que a busca `status=UNANSWERED` traz 18
   * perguntas e o painel do ML mostra 3 "a responder"? O filtro por anúncio
   * ativo foi a hipótese errada (as 3 do painel estão num anúncio PAUSADO).
   * Aqui o app devolve, pra cada pergunta pendente, os campos crus que o ML
   * manda + o status do anúncio + se ela aparece em `/my/received_questions`
   * (a busca do lado do vendedor) — pra achar o critério pelo dado, não chute.
   */
  async diagnosticoPendentes(empresaId: string, sellerId: string) {
    const porSeller = await this.listarNaoRespondidas(empresaId, sellerId);
    let meus: MLQuestion[] = [];
    let erroMeus: string | null = null;
    try {
      const r = await this.ml.get<{ questions?: MLQuestion[] }>(
        empresaId,
        `/my/received_questions/search?status=UNANSWERED&limit=50&api_version=4`,
      );
      meus = r.questions ?? [];
    } catch (err) {
      erroMeus = err instanceof Error ? err.message : String(err);
    }
    const idsMeus = new Set(meus.map((q) => q.id));
    const itens = [...new Set(porSeller.map((q) => String(q.item_id)))];
    const statusItem = new Map<string, string>();
    for (let i = 0; i < itens.length; i += 20) {
      const lote = itens.slice(i, i + 20);
      const r = await this.ml.get<Array<{ code: number; body?: { id?: string; status?: string } }>>(
        empresaId,
        `/items?ids=${lote.join(',')}&attributes=id,status,sub_status`,
      );
      for (const it of r ?? []) {
        if (it.body?.id) statusItem.set(it.body.id, String(it.body.status));
      }
    }
    return {
      totalPorSeller: porSeller.length,
      totalMeusRecebidos: meus.length,
      erroMeusRecebidos: erroMeus,
      perguntas: porSeller.map((q) => {
        const cru = q as unknown as Record<string, unknown>;
        return {
          id: q.id,
          data: q.date_created,
          itemId: q.item_id,
          statusAnuncio: statusItem.get(String(q.item_id)) ?? null,
          status: q.status,
          emMeusRecebidos: idsMeus.has(q.id),
          // campos extras que o ML manda e o tipo não declara (hold, deleted_from_listing…)
          extras: Object.fromEntries(
            Object.entries(cru).filter(
              ([k]) =>
                ![
                  'id',
                  'text',
                  'from',
                  'answer',
                  'date_created',
                  'item_id',
                  'seller_id',
                  'status',
                ].includes(k),
            ),
          ),
        };
      }),
    };
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
