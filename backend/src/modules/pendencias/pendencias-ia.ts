/**
 * IA da aba Pendências (fase 2, Léo 25/10). Regras, PURO:
 * - Se tem a resposta (base de conhecimento, pedido, histórico), a IA responde
 *   direto no marketplace.
 * - Se não tem, ou o assunto pede decisão (reembolso, contestação, avaria,
 *   troca fora da regra), ESCALA pro humano — mas antes manda uma resposta
 *   curta de espera, sem prometer nada: a loja SEMPRE tem a última palavra,
 *   em qualquer chat (Léo, 25/10). "Obrigado" do cliente também ganha resposta.
 * - A IA só ESCREVE mensagem. Nunca aceita devolução, reembolsa nem contesta.
 */

import { chaveModelo, modeloDoAnuncio } from '@modules/avaliacoes/avaliacoes';

export type AcaoIa = 'responder' | 'humano';

export interface DecisaoIa {
  acao: AcaoIa;
  resposta: string;
  motivo: string;
  /** A resposta indica o anúncio da peça unitária: o card dele vai logo depois (Léo, 29/10). */
  cardUnitario?: boolean;
}

/** Tipo da pendência → o que a IA pode fazer nele. */
export type TipoPendenciaIa = 'PERGUNTA' | 'MENSAGEM' | 'RECLAMACAO' | 'DEVOLUCAO';

/** Mensagem de espera quando a IA escala (nada de promessa, nada de prazo). */
export const ESPERA_PADRAO =
  'Oi! Já passei sua mensagem pra equipe e te respondo por aqui em seguida.';

const MAX_RESPOSTA = 1500;

export const PROMPT_PENDENCIA = `Você é atendente da Ribelt (confecção de roupas masculinas e infantis) no chat de um marketplace (Shopee ou Mercado Livre). Quem escreve é um cliente de VAREJO que comprou ou quer comprar UMA peça no marketplace.

O QUE VOCÊ RECEBE: a conversa, os ANÚNCIOS que o cliente mandou ou comprou (título, variação e descrição do anúncio), o PEDIDO (itens, tamanho/cor, situação, rastreio) e a BASE DE CONHECIMENTO da loja (ficha de cada produto com composição, tamanhos e TABELA DE MEDIDAS em cm).

COMO RESPONDER:
- Responda de verdade, com os dados que você tem. Pergunta de tamanho: olhe a tabela de medidas do produto (na descrição do anúncio ou na base) e diga as medidas do tamanho perguntado; se o cliente der peso, altura ou medida, indique o tamanho. Pergunta de pedido: diga a situação e o rastreio, se houver.
- Se o cliente só mandou o card do produto ou do pedido, sem pergunta, cumprimente citando o produto ou o pedido e pergunte como pode ajudar (ex.: "Oi! Vi que você mandou a Bermuda de Moletom. Quer saber alguma medida ou tamanho?").
- Agradecimento, "ok", emoji ou figurinha: resposta curta e simpática ("Nós que agradecemos! Qualquer coisa, é só chamar."). A loja sempre fala por último.
- A BASE é do site de ATACADO: NUNCA fale de preço de atacado, pedido mínimo, revenda, lucro, link ou site. Use a base pra produto (medidas, tamanhos, composição, cores, características) e pras REGRAS DE ATENDIMENTO da loja (tom, endereço errado, prazo de envio): siga-as sempre.
- Pra escolher a cor (ou o tamanho) de cada peça, o caminho é o anúncio da peça unitária. Se os ANÚNCIOS trazem "Anúncio da peça unitária deste kit", diga que vai mandar o anúncio aqui e marque card_unitario = true: o card do anúncio vai logo depois do seu texto. Se não trazem, não prometa mandar nada. Em qualquer outro caso, card_unitario = false.
- Quando a descrição do anúncio e a BASE disserem coisas diferentes (composição, medida, gramatura, FPS, quantidade de peças do kit), vale a BASE: é a informação conferida pela loja.
- Não invente medida, prazo, estoque, cor nem política. Se a informação não está no que você recebeu, não chute.
- Português do Brasil, simpático e direto, como uma pessoa da loja: 1 a 3 frases, sem emoji, sem markdown, sem "Olá! Recebemos sua mensagem".
- NUNCA peça desculpas ("desculpa a demora", "lamentamos", "sentimos muito"): vá direto à solução.
- Nunca peça nem passe telefone, e-mail, WhatsApp, link ou rede social (o marketplace proíbe).

Se a BASE traz o caminho pro caso (ex.: endereço errado, prazo de envio de pedido Full ou Crossdocking), RESPONDA com ele em vez de passar pra equipe.

QUANDO PASSAR PRA EQUIPE ("humano"): cancelamento, troca, devolução, reembolso, defeito, avaria, peça errada ou faltando, atraso, contestação, reclamação, ou pergunta cuja resposta não está no que você recebeu. Nesses casos a "resposta" é uma mensagem curta e humana que mostra que entendeu o caso, sem prometer nada e sem prazo (ex.: "Entendi, você não conseguiu cancelar o pedido. Já passei pra equipe e te respondo por aqui em seguida."). Nunca diga que aceitou, cancelou, trocou ou vai reembolsar.

Responda em JSON: {"acao": "responder" | "humano", "resposta": "texto pronto pra enviar", "motivo": "por que, em poucas palavras", "card_unitario": true | false}.`;

export const SCHEMA_PENDENCIA = {
  name: 'resposta_pendencia',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      acao: { type: 'string', enum: ['responder', 'humano'] },
      resposta: { type: 'string' },
      motivo: { type: 'string' },
      card_unitario: { type: 'boolean' },
    },
    required: ['acao', 'resposta', 'motivo', 'card_unitario'],
    additionalProperties: false,
  },
};

/**
 * Lê a saída da IA. Qualquer coisa estranha (JSON quebrado, ação desconhecida,
 * resposta vazia) vira "humano" com a espera padrão — nunca um silêncio, nunca
 * uma resposta inventada.
 */
export function lerDecisao(bruto: string): DecisaoIa {
  try {
    const j = JSON.parse(bruto) as Partial<DecisaoIa> & { card_unitario?: unknown };
    const resposta = String(j.resposta ?? '')
      .trim()
      .slice(0, MAX_RESPOSTA);
    const motivo = String(j.motivo ?? '')
      .trim()
      .slice(0, 300);
    if (j.acao === 'responder' && resposta)
      return { acao: 'responder', resposta, motivo, cardUnitario: j.card_unitario === true };
    if (j.acao === 'humano') return { acao: 'humano', resposta: resposta || ESPERA_PADRAO, motivo };
  } catch {
    // cai no padrão abaixo
  }
  return { acao: 'humano', resposta: ESPERA_PADRAO, motivo: 'resposta da IA ilegível' };
}

export interface MensagemHistorico {
  daLoja: boolean;
  texto: string;
}

/** Anúncio que apareceu na conversa ou no pedido (dado vivo do marketplace). */
export interface AnuncioContexto {
  id: string;
  nome: string;
  descricao: string;
  /** item_id do anúncio da peça unitária que a descrição do kit aponta. */
  unitario?: string | null;
}

/**
 * Anúncio da peça unitária que a descrição do kit aponta (Léo, 29/10): link da
 * Shopee no formato /product/<loja>/<item> ou no fim do nome, -i.<loja>.<item>.
 */
export function unitarioDoAnuncio(a: { id: string; descricao: string }): string | null {
  for (const m of a.descricao.matchAll(
    /shopee\.com\.br\/(?:product\/\d+\/(\d+)|\S*?-i\.\d+\.(\d+))/g,
  )) {
    const id = m[1] ?? m[2];
    if (id && id !== a.id) return id;
  }
  return null;
}

/** Card do marketplace no histórico: "[produto: 123]" e "[pedido: ABC]". */
export function cardsDoHistorico(h: MensagemHistorico[]): { itens: string[]; pedidos: string[] } {
  const itens = new Set<string>();
  const pedidos = new Set<string>();
  for (const m of h) {
    for (const x of m.texto.matchAll(/\[produto: ([^\]\s]+)\]/g)) if (x[1] !== '?') itens.add(x[1]);
    for (const x of m.texto.matchAll(/\[pedido: ([^\]\s]+)\]/g))
      if (x[1] !== '?') pedidos.add(x[1]);
  }
  return { itens: [...itens], pedidos: [...pedidos] };
}

/** Texto da mensagem como a IA deve ler (card vira o nome do produto). */
export function textoLegivel(texto: string, anuncios: AnuncioContexto[]): string {
  return texto
    .replace(/\[produto: ([^\]]+)\]/g, (_, id: string) => {
      const a = anuncios.find((x) => x.id === id);
      return a ? `[mandou o card do anúncio "${a.nome}"]` : '[mandou o card de um anúncio]';
    })
    .replace(/\[pedido: ([^\]]+)\]/g, '[mandou o card do pedido $1]')
    .replace(/^\[(sticker|figurinha)\]$/i, '[mandou uma figurinha]')
    .replace(/^\[imagem\]$/i, '[mandou uma foto]');
}

const MAX_CONHECIMENTO = 40_000;

/**
 * Que parte da base vai pra IA (Léo, 26/10 — economia de token): se a conversa
 * tem produto (card do anúncio ou item do pedido), vai a FICHA desse produto
 * (medidas de todas as linhas) + os textos que não são de produto (troca,
 * pós-venda). Sem produto, ou sem ficha que bata, vai a base inteira.
 */
export function baseParaConversa<T extends { titulo: string; categoria: string | null }>(
  base: T[],
  produtos: string[],
): T[] {
  const alvos = new Set(
    produtos
      .map((t) => modeloDoAnuncio(t))
      .filter((x): x is string => !!x)
      .map(chaveModelo),
  );
  if (!alvos.size) return base;
  const doProduto = (c: T) => /^produto\s*·/i.test(c.titulo) || c.categoria === 'produtos';
  const nome = (c: T) => chaveModelo(c.titulo.replace(/^produto\s*·\s*/i, ''));
  const fichas = base.filter((c) => doProduto(c) && alvos.has(nome(c)));
  if (!fichas.length) return base;
  return [...base.filter((c) => !doProduto(c)), ...fichas];
}
const MAX_DESCRICAO = 3000;

/** Monta o que a IA lê: conversa, anúncios, pedido e a base INTEIRA (Léo, 26/10). */
export function contextoDaPendencia(p: {
  canal: string;
  tipo: TipoPendenciaIa;
  titulo: string;
  conhecimento: Array<{ titulo: string; conteudo: string }>;
  pedido?: string | null;
  anuncios?: AnuncioContexto[];
  historico: MensagemHistorico[];
}): string {
  const canal =
    p.canal === 'MARKETPLACE_ML'
      ? 'Mercado Livre'
      : p.canal === 'MARKETPLACE_SHOPEE'
        ? 'Shopee'
        : p.canal;
  const tipo: Record<TipoPendenciaIa, string> = {
    PERGUNTA: 'pergunta de pré-venda',
    MENSAGEM: 'mensagem no chat',
    RECLAMACAO: 'reclamação',
    DEVOLUCAO: 'devolução',
  };
  const anuncios = p.anuncios ?? [];
  let base = '';
  for (const c of p.conhecimento) {
    const bloco = `## ${c.titulo}\n${c.conteudo}\n\n`;
    if (base.length + bloco.length > MAX_CONHECIMENTO) break;
    base += bloco;
  }
  const conversa = p.historico
    .map((m) => `${m.daLoja ? 'LOJA' : 'CLIENTE'}: ${textoLegivel(m.texto, anuncios)}`)
    .join('\n');
  const partes = [
    `CANAL: ${canal} · TIPO: ${tipo[p.tipo]}`,
    `CONVERSA (mais antiga primeiro):\n${conversa}`,
    anuncios.length
      ? `ANÚNCIOS (do marketplace):\n${anuncios
          .map(
            (a) =>
              `### ${a.nome}\n${a.descricao.slice(0, MAX_DESCRICAO) || '(sem descrição)'}${
                a.unitario
                  ? '\nAnúncio da peça unitária deste kit: o card pode ir junto da resposta.'
                  : ''
              }`,
          )
          .join('\n\n')}`
      : null,
    p.pedido ? `PEDIDO:\n${p.pedido}` : null,
    base
      ? `BASE DE CONHECIMENTO DA LOJA:\n${base.trim()}`
      : 'BASE DE CONHECIMENTO DA LOJA: (vazia)',
  ];
  return partes.filter(Boolean).join('\n\n');
}

/**
 * O cliente terminou de escrever? (Léo, 26/10) Quem manda o card e a pergunta
 * em seguida não pode receber "como posso ajudar?" no meio do raciocínio: a IA
 * espera 30 s sem mensagem nova dele e SÓ ENTÃO lê a conversa inteira,
 * interpreta e responde — tudo de uma vez.
 */
export const SILENCIO_S = 30;
export function clienteTerminou(ultimaDoCliente: Date, agora = new Date()): boolean {
  return agora.getTime() - ultimaDoCliente.getTime() >= SILENCIO_S * 1000;
}

/** Última mensagem é do cliente? (só aí a IA entra — a loja nunca fala duas vezes seguidas sem motivo) */
export function clienteFalouPorUltimo(h: MensagemHistorico[]): boolean {
  return h.length > 0 && !h[h.length - 1].daLoja;
}
