import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
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
  status?: string;
  warranty?: string | null;
  attributes?: Array<{ name?: string; value_name?: string | null }>;
  variations?: Array<{
    available_quantity?: number;
    attribute_combinations?: Array<{ name?: string; value_name?: string | null }>;
  }>;
  shipping?: { free_shipping?: boolean };
}

/** Teto do texto do anúncio no prompt — descrição de ML pode ser enorme. */
const MAX_DESCRICAO = 6000;
/** O ML aceita até 2000 caracteres numa resposta. */
const MAX_RESPOSTA = 2000;

export const PROMPT_RESPOSTA_PERGUNTA = `Você responde perguntas de compradores num anúncio do Mercado Livre, em nome do vendedor.

REGRAS:
- Use SOMENTE as informações do anúncio abaixo (título, atributos, variações, estoque e descrição). Não invente medida, cor, prazo, material, garantia ou qualquer dado que não esteja ali.
- Se a resposta não estiver no anúncio, diga com educação que vai confirmar e responder em breve — não chute.
- Português do Brasil, cordial e direto, 1 a 3 frases. Sem emojis, sem markdown.
- Não peça nem passe telefone, e-mail, link externo ou rede social (o Mercado Livre proíbe).
- Não comece com "Olá, tudo bem?" longo: um cumprimento curto basta.
- Responda apenas com o texto da resposta, pronto pra enviar.`;

/** Monta o bloco do anúncio que vai pro modelo. Exportado pra teste. */
export function contextoDoAnuncio(item: ItemML, descricao: string | null): string {
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
  const partes = [
    `TÍTULO: ${item.title ?? '—'}`,
    item.price !== undefined ? `PREÇO: R$ ${item.price.toFixed(2).replace('.', ',')}` : null,
    item.condition ? `CONDIÇÃO: ${item.condition === 'new' ? 'novo' : item.condition}` : null,
    item.available_quantity !== undefined ? `ESTOQUE TOTAL: ${item.available_quantity}` : null,
    item.shipping?.free_shipping ? 'FRETE GRÁTIS: sim' : null,
    item.warranty ? `GARANTIA: ${item.warranty}` : null,
    atributos ? `ATRIBUTOS:\n${atributos}` : null,
    variacoes ? `VARIAÇÕES DISPONÍVEIS:\n${variacoes}` : null,
    descricao ? `DESCRIÇÃO:\n${descricao.slice(0, MAX_DESCRICAO)}` : null,
  ];
  return partes.filter(Boolean).join('\n\n');
}

/**
 * Sugestão de resposta pra pergunta de pré-venda do ML, com a OpenAI lendo o
 * próprio anúncio (Léo, 29/09). Hoje é o botão da aba Marketplaces — o texto
 * volta pro campo e o vendedor revisa antes de enviar. É também a peça que a
 * resposta AUTOMÁTICA vai usar depois: por isso fica num serviço próprio, que
 * recebe só empresa + pergunta e não depende da tela.
 */
@Injectable()
export class MLRespostaIaService {
  private readonly logger = new Logger(MLRespostaIaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ml: MLClientService,
    private readonly bot: MullerBotService,
  ) {}

  /** Da conversa da aba (q:<id>) pra sugestão — confere que é da empresa e é pergunta do ML. */
  async sugerirPorConversa(
    empresaId: string,
    conversationId: string,
  ): Promise<{ texto: string; modelo: string; itemId: string }> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, empresaId, canal: 'MARKETPLACE_ML' },
      select: { peerId: true },
    });
    if (!conv) throw new NotFoundException('Conversation', conversationId);
    if (!conv.peerId.startsWith('q:')) {
      throw new BusinessRuleException('Sugestão pela IA só existe pra pergunta de anúncio.');
    }
    return this.sugerir(empresaId, conv.peerId.slice(2));
  }

  async sugerir(
    empresaId: string,
    questionId: string,
  ): Promise<{ texto: string; modelo: string; itemId: string }> {
    const q = await this.ml.get<MLQuestion>(empresaId, `/questions/${questionId}`);
    const itemId = String(q.item_id);
    const [item, desc] = await Promise.all([
      this.ml.get<ItemML>(empresaId, `/items/${itemId}`),
      this.ml
        .get<{ plain_text?: string; text?: string }>(empresaId, `/items/${itemId}/description`)
        .catch((err: unknown) => {
          // Anúncio sem descrição responde 404 — segue com título e atributos.
          const m = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Descrição do anúncio ${itemId} indisponível: ${m}`);
          return null;
        }),
    ]);
    const descricao = (desc?.plain_text || desc?.text || '').trim() || null;
    const mensagem = `ANÚNCIO:\n${contextoDoAnuncio(item, descricao)}\n\nPERGUNTA DO COMPRADOR:\n${q.text}`;
    const r = await this.bot.gerarRespostaIa(empresaId, PROMPT_RESPOSTA_PERGUNTA, mensagem);
    const texto = r.texto.trim().slice(0, MAX_RESPOSTA);
    if (!texto) throw new BusinessRuleException('A IA não devolveu resposta. Tente de novo.');
    return { texto, modelo: r.modelo, itemId };
  }
}
