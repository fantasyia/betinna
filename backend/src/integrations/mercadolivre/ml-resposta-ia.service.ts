import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { MullerBotService } from '@modules/mullerbot/mullerbot.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { MLClientService } from './ml-client.service';
import type { MLQuestion } from './ml.types';

/** O que o ML devolve do anúncio (só os campos que entram no prompt). */
interface ItemML {
  id: string;
  title?: string;
  price?: number;
  available_quantity?: number;
  condition?: string;
  warranty?: string | null;
  attributes?: Array<{ name?: string; value_name?: string | null }>;
  variations?: Array<{
    available_quantity?: number;
    attribute_combinations?: Array<{ name?: string; value_name?: string | null }>;
  }>;
  shipping?: { free_shipping?: boolean };
}

/** Pergunta já respondida do MESMO anúncio, lida do nosso banco. */
export interface PerguntaRespondida {
  pergunta: string;
  resposta: string;
}

export type ResultadoSugestao =
  | { texto: string; precisaHumano: false; fonte: 'base' | 'descricao'; modelo: string }
  | { texto: null; precisaHumano: true; fonte: null; modelo: string | null };

export interface ResumoAnuncio {
  id: string;
  titulo: string | null;
  link: string | null;
  status: string | null;
  thumbnail: string | null;
}

/** Etiqueta interna que marca a pergunta pra um humano responder. */
export const TAG_HUMANO = 'humano';

/** Teto do texto do anúncio no prompt — descrição de ML pode ser enorme. */
const MAX_DESCRICAO = 6000;
/** O ML aceita até 2000 caracteres numa resposta. */
const MAX_RESPOSTA = 2000;
/** Dados do anúncio (estoque muda) ficam pouco em cache; a descrição, um dia. */
const TTL_ITEM_S = 30 * 60;
const TTL_DESCRICAO_S = 24 * 3600;
const MAX_ANTERIORES = 15;

export const PROMPT_RESPOSTA_PERGUNTA = `Você responde perguntas de compradores num anúncio do Mercado Livre, em nome do vendedor.

REGRAS:
- Use SOMENTE as informações fornecidas (dados do anúncio, respostas anteriores do vendedor e, quando houver, a descrição). Não invente medida, cor, prazo, material, garantia ou qualquer dado.
- Se a informação necessária NÃO estiver no que foi fornecido, NÃO responda: devolva "sabe": false e "resposta": "". Um humano vai responder. Não escreva "vou confirmar" nem nada parecido.
- Quando souber: português do Brasil, cordial e direto, 1 a 3 frases, cumprimento curto. Sem emojis, sem markdown.
- Não peça nem passe telefone, e-mail, link externo ou rede social (o Mercado Livre proíbe).

Responda em JSON: {"sabe": true|false, "resposta": "texto pronto pra enviar, ou vazio"}.`;

const SCHEMA_RESPOSTA = {
  name: 'resposta_pergunta_ml',
  strict: true,
  schema: {
    type: 'object',
    properties: { sabe: { type: 'boolean' }, resposta: { type: 'string' } },
    required: ['sabe', 'resposta'],
    additionalProperties: false,
  },
};

/** Dados curtos do anúncio (sem descrição). Exportado pra teste. */
export function dadosDoAnuncio(item: ItemML): string {
  const atributos = (item.attributes ?? [])
    .filter((a) => a.name && a.value_name)
    .map((a) => `- ${a.name}: ${a.value_name}`)
    .join('\n');
  const variacoes = (item.variations ?? [])
    .map((v) => {
      const nome = (v.attribute_combinations ?? [])
        .map((c) => [c.name, c.value_name].filter(Boolean).join(': '))
        .join(', ');
      return `- ${nome || 'variação'} (estoque: ${v.available_quantity ?? '?'})`;
    })
    .join('\n');
  return [
    `TÍTULO: ${item.title ?? '—'}`,
    item.price !== undefined ? `PREÇO: R$ ${item.price.toFixed(2).replace('.', ',')}` : null,
    item.condition ? `CONDIÇÃO: ${item.condition === 'new' ? 'novo' : item.condition}` : null,
    item.available_quantity !== undefined ? `ESTOQUE TOTAL: ${item.available_quantity}` : null,
    item.shipping?.free_shipping ? 'FRETE GRÁTIS: sim' : null,
    item.warranty ? `GARANTIA: ${item.warranty}` : null,
    atributos ? `ATRIBUTOS:\n${atributos}` : null,
    variacoes ? `VARIAÇÕES DISPONÍVEIS:\n${variacoes}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Lê o JSON do modelo; qualquer coisa fora do formato conta como "não sabe". */
export function lerResposta(bruto: string): { sabe: boolean; resposta: string } {
  try {
    const j = JSON.parse(bruto) as { sabe?: unknown; resposta?: unknown };
    const resposta = typeof j.resposta === 'string' ? j.resposta.trim() : '';
    return { sabe: j.sabe === true && resposta.length > 0, resposta };
  } catch {
    return { sabe: false, resposta: '' };
  }
}

/**
 * Sugestão de resposta pra pergunta de pré-venda do ML (Léo, 29/09).
 *
 * Em DUAS etapas, pra gastar o mínimo:
 *  1. BASE — a pergunta e o anúncio vêm do nosso banco (a pergunta já foi
 *     importada; o anúncio fica 30 min em cache), junto com as respostas que o
 *     vendedor já deu no MESMO anúncio. Sem descrição.
 *  2. DESCRIÇÃO — só se a etapa 1 não achou a resposta: busca a descrição do
 *     anúncio (cache de 24h) e pergunta de novo.
 * Se nem assim tiver a informação, NÃO responde: marca a conversa com a
 * etiqueta `humano` e devolve `precisaHumano`. A IA nunca chuta.
 *
 * Hoje atende o botão da aba Marketplaces (o texto volta pro campo, o vendedor
 * revisa). É a mesma peça que a resposta automática vai usar — por isso recebe
 * só empresa + conversa e não depende da tela.
 */
@Injectable()
export class MLRespostaIaService {
  private readonly logger = new Logger(MLRespostaIaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ml: MLClientService,
    private readonly bot: MullerBotService,
    private readonly redis: RedisService,
  ) {}

  async sugerirPorConversa(empresaId: string, conversationId: string): Promise<ResultadoSugestao> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, empresaId, canal: 'MARKETPLACE_ML' },
      select: { id: true, peerId: true, tagsInternas: true },
    });
    if (!conv) throw new NotFoundException('Conversation', conversationId);
    if (!conv.peerId.startsWith('q:')) {
      throw new BusinessRuleException('Sugestão pela IA só existe pra pergunta de anúncio.');
    }
    const { texto: pergunta, itemId } = await this.lerPergunta(
      empresaId,
      conv.id,
      conv.peerId.slice(2),
    );

    // Etapa 1 — só o que já temos: dados do anúncio + respostas anteriores.
    const [item, anteriores] = await Promise.all([
      this.anuncio(empresaId, itemId),
      this.respondidasDoAnuncio(empresaId, itemId, conv.id),
    ]);
    const base = [
      `ANÚNCIO:\n${dadosDoAnuncio(item)}`,
      anteriores.length
        ? `RESPOSTAS QUE O VENDEDOR JÁ DEU NESTE ANÚNCIO:\n${anteriores
            .map((a) => `P: ${a.pergunta}\nR: ${a.resposta}`)
            .join('\n\n')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n\n');
    const r1 = await this.perguntarIa(empresaId, base, pergunta);
    if (r1.sabe) return { ...r1.saida, fonte: 'base' };

    // Etapa 2 — a descrição, só agora.
    const descricao = await this.descricao(empresaId, itemId);
    if (descricao) {
      const r2 = await this.perguntarIa(
        empresaId,
        `${base}\n\nDESCRIÇÃO DO ANÚNCIO:\n${descricao.slice(0, MAX_DESCRICAO)}`,
        pergunta,
      );
      if (r2.sabe) return { ...r2.saida, fonte: 'descricao' };
    }

    await this.marcarHumano(conv.id, conv.tagsInternas);
    this.logger.log(`Pergunta ${conv.peerId}: IA sem informação no anúncio — marcada pra humano`);
    return { texto: null, precisaHumano: true, fonte: null, modelo: r1.modelo };
  }

  private async perguntarIa(
    empresaId: string,
    contexto: string,
    pergunta: string,
  ): Promise<
    | { sabe: true; saida: { texto: string; precisaHumano: false; modelo: string }; modelo: string }
    | { sabe: false; modelo: string }
  > {
    const r = await this.bot.gerarRespostaIa(
      empresaId,
      PROMPT_RESPOSTA_PERGUNTA,
      `${contexto}\n\nPERGUNTA DO COMPRADOR:\n${pergunta}`,
      [],
      undefined,
      { responseFormat: SCHEMA_RESPOSTA },
    );
    const j = lerResposta(r.texto);
    if (!j.sabe) return { sabe: false, modelo: r.modelo };
    return {
      sabe: true,
      modelo: r.modelo,
      saida: { texto: j.resposta.slice(0, MAX_RESPOSTA), precisaHumano: false, modelo: r.modelo },
    };
  }

  /** A pergunta vem da mensagem já importada; só vai ao ML se ela não tiver o anúncio. */
  private async lerPergunta(
    empresaId: string,
    conversationId: string,
    questionId: string,
  ): Promise<{ texto: string; itemId: string }> {
    const msgs = await this.prisma.message.findMany({
      where: { conversationId, direction: 'INBOUND' },
      orderBy: { criadoEm: 'asc' },
      take: 5,
      select: { conteudo: true, meta: true },
    });
    const msg = msgs.find((m) => (m.meta as { ml_item_id?: unknown } | null)?.ml_item_id);
    const itemId = (msg?.meta as { ml_item_id?: string } | null)?.ml_item_id;
    if (msg && itemId) return { texto: msg.conteudo, itemId: String(itemId) };
    const q = await this.ml.get<MLQuestion>(empresaId, `/questions/${questionId}`);
    return { texto: q.text, itemId: String(q.item_id) };
  }

  /** Perguntas do mesmo anúncio que já têm resposta enviada — do nosso banco, sem API. */
  async respondidasDoAnuncio(
    empresaId: string,
    itemId: string,
    excetoConversa: string,
  ): Promise<PerguntaRespondida[]> {
    const perguntas = await this.prisma.message.findMany({
      where: {
        direction: 'INBOUND',
        meta: { path: ['ml_item_id'], equals: itemId },
        conversation: { empresaId, canal: 'MARKETPLACE_ML', id: { not: excetoConversa } },
      },
      orderBy: { criadoEm: 'desc' },
      take: MAX_ANTERIORES,
      select: {
        conteudo: true,
        conversation: {
          select: {
            mensagens: {
              where: { direction: 'OUTBOUND', status: { not: 'FAILED' } },
              orderBy: { criadoEm: 'desc' },
              take: 1,
              select: { conteudo: true },
            },
          },
        },
      },
    });
    return perguntas
      .map((p) => ({ pergunta: p.conteudo, resposta: p.conversation.mensagens[0]?.conteudo ?? '' }))
      .filter((p) => p.resposta);
  }

  /**
   * Título, link e status do anúncio pra tela da pergunta (card ML, 30/09).
   * Cache curto: o link não muda, mas o status (pausado/ativo) muda.
   */
  async resumoAnuncio(empresaId: string, itemId: string): Promise<ResumoAnuncio> {
    const it = await this.emCache(`ml:item-resumo:${empresaId}:${itemId}`, TTL_ITEM_S, () =>
      this.ml.get<{
        id: string;
        title?: string;
        permalink?: string;
        status?: string;
        thumbnail?: string;
      }>(empresaId, `/items/${itemId}?attributes=id,title,permalink,status,thumbnail`),
    );
    return {
      id: it.id,
      titulo: it.title ?? null,
      link: it.permalink ?? null,
      status: it.status ?? null,
      thumbnail: it.thumbnail ?? null,
    };
  }

  private async anuncio(empresaId: string, itemId: string): Promise<ItemML> {
    return this.emCache(`ml:item:${empresaId}:${itemId}`, TTL_ITEM_S, () =>
      this.ml.get<ItemML>(
        empresaId,
        `/items/${itemId}?attributes=id,title,price,available_quantity,condition,warranty,attributes,variations,shipping`,
      ),
    );
  }

  private async descricao(empresaId: string, itemId: string): Promise<string | null> {
    const d = await this.emCache(`ml:desc:${empresaId}:${itemId}`, TTL_DESCRICAO_S, async () => {
      try {
        const r = await this.ml.get<{ plain_text?: string; text?: string }>(
          empresaId,
          `/items/${itemId}/description`,
        );
        return { texto: (r?.plain_text || r?.text || '').trim() };
      } catch (err) {
        // Anúncio sem descrição responde 404 — guarda o "vazio" pra não perguntar de novo.
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Descrição do anúncio ${itemId} indisponível: ${m}`);
        return { texto: '' };
      }
    });
    return d.texto || null;
  }

  /** Cache no Redis; Redis fora do ar só faz buscar direto. */
  private async emCache<T>(chave: string, ttlS: number, buscar: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.redis.client.get(chave);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      // segue sem cache
    }
    const v = await buscar();
    try {
      await this.redis.client.set(chave, JSON.stringify(v), 'EX', ttlS);
    } catch {
      // cache é otimização
    }
    return v;
  }

  /** Marca a pergunta pra um humano (ex.: a resposta automática não conseguiu enviar). */
  async marcarParaHumano(conversationId: string): Promise<void> {
    const c = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { tagsInternas: true },
    });
    if (c) await this.marcarHumano(conversationId, c.tagsInternas);
  }

  private async marcarHumano(conversationId: string, tags: string[]): Promise<void> {
    if (tags.some((t) => t.toLowerCase() === TAG_HUMANO)) return;
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { tagsInternas: [...tags, TAG_HUMANO] },
    });
  }
}
