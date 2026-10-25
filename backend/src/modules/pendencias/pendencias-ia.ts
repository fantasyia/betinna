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
  'Olá! Recebemos sua mensagem e nossa equipe já está verificando. Retornamos em breve por aqui.';

const MAX_RESPOSTA = 1500;

export const PROMPT_PENDENCIA = `Você atende clientes de uma confecção de roupas no chat de um marketplace (Mercado Livre ou Shopee), em nome da loja.

REGRAS:
- A loja SEMPRE manda a última mensagem. Se o cliente só agradeceu ou mandou emoji, responda curto e cordial (ex.: "Nós que agradecemos! Qualquer coisa, estamos aqui."). Isso é "responder".
- Use SOMENTE as informações fornecidas (base de conhecimento, pedido, anúncio, histórico). Não invente prazo, medida, cor, estoque, política ou valor.
- Escolha "humano" quando: a informação necessária não está no que foi fornecido; o cliente pede reembolso, cancelamento, devolução ou troca; reclama de defeito, avaria, peça errada ou faltando; contesta algo; ou o assunto pede uma decisão da loja. No "humano", a "resposta" é uma mensagem curta de espera, sem prometer nada e sem prazo (ex.: "Olá! Recebemos sua mensagem e nossa equipe já está verificando. Retornamos em breve por aqui.").
- Você só escreve a mensagem. Nunca diga que aceitou devolução, que vai reembolsar, cancelar ou trocar.
- Português do Brasil, cordial e direto, 1 a 3 frases. Sem emojis, sem markdown.
- Não peça nem passe telefone, e-mail, WhatsApp, link externo ou rede social (o marketplace proíbe).

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

/** Monta o que a IA lê: conhecimento, pedido e a conversa (mais antiga primeiro). */
export function contextoDaPendencia(p: {
  canal: string;
  tipo: TipoPendenciaIa;
  titulo: string;
  conhecimento: Array<{ titulo: string; conteudo: string }>;
  pedido?: string | null;
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
    MENSAGEM: 'mensagem de pós-venda',
    RECLAMACAO: 'reclamação',
    DEVOLUCAO: 'devolução',
  };
  const partes = [
    `CANAL: ${canal} · TIPO: ${tipo[p.tipo]} · ${p.titulo}`,
    p.conhecimento.length
      ? `BASE DE CONHECIMENTO DA LOJA:\n${p.conhecimento
          .map((c) => `## ${c.titulo}\n${c.conteudo.slice(0, 1500)}`)
          .join('\n\n')}`
      : 'BASE DE CONHECIMENTO DA LOJA: (nada relevante)',
    p.pedido ? `PEDIDO:\n${p.pedido}` : null,
    `CONVERSA (mais antiga primeiro):\n${p.historico
      .map((m) => `${m.daLoja ? 'LOJA' : 'CLIENTE'}: ${m.texto}`)
      .join('\n')}`,
  ];
  return partes.filter(Boolean).join('\n\n');
}

/** Última mensagem é do cliente? (só aí a IA entra — a loja nunca fala duas vezes seguidas sem motivo) */
export function clienteFalouPorUltimo(h: MensagemHistorico[]): boolean {
  return h.length > 0 && !h[h.length - 1].daLoja;
}
