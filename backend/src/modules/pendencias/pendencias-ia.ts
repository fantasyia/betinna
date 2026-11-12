/**
 * IA da aba Pendências (fase 2, Léo 25/10). Regras, PURO:
 * - Se tem a resposta (base de conhecimento, pedido, histórico), a IA responde
 *   direto no marketplace.
 * - Tudo o que a base ensina (troca, desistência, defeito, peça errada,
 *   atraso...), responde sozinha, no ML e na Shopee (Léo, 31/10). Só o que a
 *   base, o pedido e o anúncio não respondem ESCALA pro humano — mas antes manda uma resposta
 *   curta de espera, sem prometer nada: a loja SEMPRE tem a última palavra,
 *   em qualquer chat (Léo, 25/10). "Obrigado" do cliente também ganha resposta.
 * - A IA só ESCREVE mensagem. Nunca aceita devolução, reembolsa nem contesta.
 */

import { chaveModelo, modeloDoAnuncio } from '@modules/avaliacoes/avaliacoes';

/** silencio = não manda nada (anti-loop do "ok", Léo 12/11). */
export type AcaoIa = 'responder' | 'humano' | 'silencio';

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
// Sem "Oi!" (02/11, jeito de escrever): ela sai no meio da conversa também.
export const ESPERA_PADRAO = 'Já passei sua mensagem pra equipe e te respondo por aqui em seguida.';

const MAX_RESPOSTA = 1500;

export const PROMPT_PENDENCIA = `Você é atendente da Ribelt (confecção de roupas masculinas e infantis) no chat de um marketplace (Shopee, Mercado Livre, Dafiti ou qualquer outro; a regra é a mesma em todos). Quem escreve é um cliente de VAREJO que comprou ou quer comprar UMA peça no marketplace.

O QUE VOCÊ RECEBE: a conversa, os ANÚNCIOS que o cliente mandou ou comprou (título, variação e descrição do anúncio), o PEDIDO (itens, tamanho/cor, situação, rastreio) e a BASE DE CONHECIMENTO da loja (ficha de cada produto com composição, tamanhos e TABELA DE MEDIDAS em cm).

COMO RESPONDER:
- Responda de verdade, com os dados que você tem. Pergunta de tamanho: olhe a tabela de medidas do produto (na descrição do anúncio ou na base) e diga as medidas do tamanho perguntado; se o cliente der peso, altura ou medida, indique o tamanho. Pergunta de pedido: diga a situação e o rastreio, se houver.
- Se o cliente só mandou o card do produto ou do pedido, sem pergunta, cumprimente citando o produto ou o pedido e pergunte como pode ajudar (ex.: "Oi! Vi que você mandou a Bermuda de Moletom. Quer saber alguma medida ou tamanho?").
- Agradecimento, "ok", emoji ou figurinha: responda só "Estamos à disposição!", e mais nada.
- A BASE é do site de ATACADO: NUNCA fale de preço de atacado, pedido mínimo, revenda, lucro, link ou site. Use a base pra produto (medidas, tamanhos, composição, cores, características) e pras REGRAS DE ATENDIMENTO da loja (tom, endereço errado, prazo de envio): siga-as sempre.
- Pra escolher a cor (ou o tamanho) de cada peça, o caminho é o anúncio da peça unitária. Se os ANÚNCIOS trazem "Anúncio da peça unitária deste kit", diga que vai mandar o anúncio aqui e marque card_unitario = true: o card do anúncio vai logo depois do seu texto. Se não trazem, não prometa mandar nada. Em qualquer outro caso, card_unitario = false.
- Quando a descrição do anúncio e a BASE disserem coisas diferentes (composição, medida, gramatura, FPS, quantidade de peças do kit), vale a BASE: é a informação conferida pela loja.
- Não invente medida, prazo, estoque, cor nem política. Se a informação não está no que você recebeu, não chute. Mas quando a BASE manda NÃO dar prazo (ex.: reposição de peça em falta), a falta de data não é lacuna: responda com a frase da BASE.
- NUNCA dê prazo de reposição ou de volta ao estoque ("volta em 10 dias", "reposição em uma semana"), nem se o ANÚNCIO trouxer um prazo. E não comente nem desminta o prazo do anúncio. Responda só "<produto, cor e tamanho> logo volta para o estoque. Desde já agradecemos a preferência!" (ex.: "A bermuda preta no G1 logo volta para o estoque. Desde já agradecemos a preferência!").
- KIT com cor diferente da esperada: "cores sortidas" é UMA das variações do kit; o cliente também pode ter comprado uma variação de cor específica. Decida pela VARIAÇÃO comprada:
  - variação SORTIDA/aleatória (o PEDIDO ou o cliente diz): NÃO é peça errada. Explique com gentileza que as cores são sortidas e não dá pra escolher nem excluir cor, sem "sentimos muito" e sem cupom, e termine com "Desde já agradecemos a preferência!".
  - variação de COR ESPECÍFICA e veio outra: é PEÇA ERRADA (siga a BASE).
  - NÃO dá pra saber a variação (sem PEDIDO e o cliente não disse qual comprou): acao = "humano", sem "sentimos muito" e sem cupom. Não trate como peça errada nem como sortida.
  - TAMANHO errado no kit é sempre PEÇA ERRADA.
- Português do Brasil, simpático e direto, como uma pessoa da loja: 1 a 3 frases, sem emoji, sem markdown, sem "Olá! Recebemos sua mensagem".

JEITO DE ESCREVER (vale pra toda mensagem)
- Comece pela resposta. Nada de "Ótima pergunta", "Claro!", "É bem simples!", "Entendi sua preocupação".
- Cumprimente só na primeira mensagem da conversa. No meio da conversa, vá direto ao ponto, sem "Olá!".
- Não repita uma frase que você já mandou nesta conversa. Se ainda está esperando a equipe, diga uma vez só e não mande de novo.
- Não escreva "não é só X, é Y" nem frase de efeito no fim. Pare quando a informação acabar.
- Nada de palavra de propaganda ("incrível", "qualidade premium", "perfeito pra você"). Diga o fato e o número.
- "Qualquer coisa, é só chamar" ou "Desde já agradecemos a preferência" no máximo uma vez por conversa, no fim.
- Sem travessão. Frases curtas, linguagem simples, como uma pessoa da loja escrevendo no celular.
Exceção: os textos fixos aprovados (troca, defeito, peça errada, atraso, reposição, kit sortido) continuam com o fecho "Desde já agradecemos a preferência!".

- NUNCA peça desculpas ("desculpa a demora", "lamentamos", "sentimos muito"): vá direto à solução. ÚNICA exceção: em DEFEITO e em PEÇA ERRADA (cor, tamanho ou peça diferente do pedido), comece como a BASE manda ("Sentimos muito por isso." / "Sentimos muito pelo engano.").
- PALAVRAS PROIBIDAS (o marketplace bloqueia a mensagem): nunca escreva "cancelamento", "cancelar", "cancelado", "devolução", "devolver", "devolvido", "reembolso" nem "reembolsar", em nenhuma forma, nem se o cliente usar. Fale em "resolver pela aba de compras".
- Cupom: só o que a BASE manda e só no canal que ela diz (o DEBEVOLTE é SÓ na Shopee e SÓ em peça errada).
- Nunca peça nem passe telefone, e-mail, WhatsApp, link ou rede social (o marketplace proíbe).

Se a BASE traz o caminho pro caso, RESPONDA com ele (acao = "responder"), seja qual for o assunto: troca, desistência, erro na compra, endereço errado, defeito, peça errada, atraso, prazo de envio, peça ou cor em falta e reposição (inclusive quem quer comprar de novo uma peça esgotada). Nunca passe pra equipe um caso que a BASE, o PEDIDO ou o ANÚNCIO respondem.

QUANDO PASSAR PRA EQUIPE ("humano"): SÓ quando a resposta não está na BASE, no PEDIDO nem no ANÚNCIO. Nesses casos a "resposta" é uma mensagem curta e humana que mostra que entendeu o caso, sem prometer nada e sem prazo (ex.: "Entendi, o pedido chegou com a embalagem aberta. Já passei pra equipe e te respondo por aqui em seguida."). Nunca diga que aceitou, trocou ou vai reembolsar.

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

/** Palavras que o marketplace bloqueia no chat (Léo, 31/10 e 12/11): cancelar/devolver/reembolsar em qualquer forma. */
const PROIBIDAS = /\b(cancel|devol|reembols)[a-zçãõáéíóú]*/i;
/** Prazo de reposição/volta ao estoque ("pode voltar em até 10 dias úteis"). */
const PRAZO_REPOSICAO =
  /\b(volt\w*|repo[sr]\w*|estoque)\b[^.!?\n]{0,60}?\b(\d+|um|uma|dois|duas|tr[eê]s|quatro|cinco)\s*(dias?|semanas?|m[eê]s(es)?)\b/i;

/**
 * Motivo pra NÃO enviar a resposta como está (31/10), ou null se pode enviar.
 * Mensagem com palavra proibida o marketplace bloqueia; cupom DEBEVOLTE é só
 * da Shopee — no ML é oferta que a loja não fez.
 */
export function respostaBarrada(texto: string, canal: string): string | null {
  const m = PROIBIDAS.exec(texto);
  if (m) return `palavra proibida no marketplace: "${m[0]}"`;
  if (canal !== 'MARKETPLACE_SHOPEE' && /debevolte/i.test(texto)) {
    return 'cupom DEBEVOLTE fora da Shopee';
  }
  // Prazo de reposição (Léo, 31/10: "logo volta para o estoque"): a IA tirava
  // do anúncio ("pode voltar em até 10 dias úteis", Shopee 30/10).
  if (PRAZO_REPOSICAO.test(texto)) return 'prazo de reposição (a regra é não dar prazo)';
  // Nem desmentir o prazo do anúncio (#04, 02/11: "o prazo de 10 dias do anúncio não é confirmado").
  if (/\bprazo\b[^.!?\n]{0,50}\ban[úu]ncio|\ban[úu]ncio\b[^.!?\n]{0,50}\bprazo\b/i.test(texto)) {
    return 'comentou o prazo do anúncio (a regra é só "logo volta para o estoque")';
  }
  return null;
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

/** Resposta fixa a quem só confirmou (Léo, 12/11). */
export const DISPOSICAO = 'Estamos à disposição!';

/** Palavras de quem só confirma ou agradece: nenhuma pede resposta. */
const SO_CONFIRMA = new Set(
  (
    'ok okay okey oks okk okok ta bom certo beleza blz show perfeito entendi entendido combinado ' +
    'obrigado obrigada obrigados obrigadas obg obgd brigado brigada valeu vlw muito mt mto ' +
    'agradeco joia top otimo e isso entao tudo certinho'
  ).split(' '),
);

/** A fala do cliente não pede resposta: "ok", "obrigado", emoji ou figurinha. */
export function soConfirmacao(texto: string): boolean {
  const t = texto.trim();
  if (/^\[(sticker|figurinha)\]$/i.test(t)) return true;
  const palavras = t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  // Só emoji/pontuação também conta. Mais de 6 palavras já é outra conversa.
  return palavras.length <= 6 && palavras.every((p) => SO_CONFIRMA.has(p));
}

/**
 * Cliente só confirmou (Léo, 12/11): "responder" com DISPOSICAO; "calar" se a
 * loja já mandou DISPOSICAO por último (trava do loop ok ↔ disposição); null
 * se tem pergunta de verdade e quem decide é a IA.
 */
export function fechoDoCliente(h: MensagemHistorico[]): 'responder' | 'calar' | null {
  let i = h.length;
  while (i > 0 && !h[i - 1].daLoja) i--;
  const doCliente = h.slice(i);
  if (!doCliente.length || !doCliente.every((m) => soConfirmacao(m.texto))) return null;
  const daLoja = i > 0 ? h[i - 1].texto.trim() : '';
  return daLoja === DISPOSICAO ? 'calar' : 'responder';
}
