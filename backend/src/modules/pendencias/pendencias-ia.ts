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

export type AcaoIa = 'responder' | 'humano';

export interface DecisaoIa {
  acao: AcaoIa;
  resposta: string;
  motivo: string;
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
- A BASE é do site de ATACADO: NUNCA fale de preço de atacado, pedido mínimo, revenda, lucro, link ou site. Use a base só pra produto (medidas, tamanhos, composição, cores, características).
- Não invente medida, prazo, estoque, cor nem política. Se a informação não está no que você recebeu, não chute.
- Português do Brasil, simpático e direto, como uma pessoa da loja: 1 a 3 frases, sem emoji, sem markdown, sem "Olá! Recebemos sua mensagem".
- Nunca peça nem passe telefone, e-mail, WhatsApp, link ou rede social (o marketplace proíbe).

QUANDO PASSAR PRA EQUIPE ("humano"): cancelamento, troca, devolução, reembolso, defeito, avaria, peça errada ou faltando, atraso, contestação, reclamação, ou pergunta cuja resposta não está no que você recebeu. Nesses casos a "resposta" é uma mensagem curta e humana que mostra que entendeu o caso, sem prometer nada e sem prazo (ex.: "Entendi, você não conseguiu cancelar o pedido. Já passei pra equipe e te respondo por aqui em seguida."). Nunca diga que aceitou, cancelou, trocou ou vai reembolsar.

Responda em JSON: {"acao": "responder" | "humano", "resposta": "texto pronto pra enviar", "motivo": "por que, em poucas palavras"}.`;

export const SCHEMA_PENDENCIA = {
  name: 'resposta_pendencia',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      acao: { type: 'string', enum: ['responder', 'humano'] },
      resposta: { type: 'string' },
      motivo: { type: 'string' },
    },
    required: ['acao', 'resposta', 'motivo'],
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
    const j = JSON.parse(bruto) as Partial<DecisaoIa>;
    const resposta = String(j.resposta ?? '')
      .trim()
      .slice(0, MAX_RESPOSTA);
    const motivo = String(j.motivo ?? '')
      .trim()
      .slice(0, 300);
    if (j.acao === 'responder' && resposta) return { acao: 'responder', resposta, motivo };
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
          .map((a) => `### ${a.nome}\n${a.descricao.slice(0, MAX_DESCRICAO) || '(sem descrição)'}`)
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
 * O cliente terminou de escrever? Quem manda o card e a pergunta em seguida
 * não pode receber "como posso ajudar?" no meio (26/10): a IA espera alguns
 * minutos de silêncio desde a última mensagem dele.
 */
export const SILENCIO_MIN = 4;
export function clienteTerminou(ultimaDoCliente: Date, agora = new Date()): boolean {
  return agora.getTime() - ultimaDoCliente.getTime() >= SILENCIO_MIN * 60_000;
}

/** Última mensagem é do cliente? (só aí a IA entra — a loja nunca fala duas vezes seguidas sem motivo) */
export function clienteFalouPorUltimo(h: MensagemHistorico[]): boolean {
  return h.length > 0 && !h[h.length - 1].daLoja;
}
