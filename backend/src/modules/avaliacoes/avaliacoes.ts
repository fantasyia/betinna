import { corDoCadastro } from '@modules/kits/composicao';

/**
 * Avaliações da Shopee na vitrine (Léo, 23–25/10; card cmvleo3tv). Regras, PURO:
 * - só 5 estrelas, só COM foto, só comentário + foto (nada de nome do comprador);
 * - só cores que existem no site (todas as cores da variação comprada);
 * - nada que cite marketplace, Debex, Shopee, frete/entrega ou a embalagem —
 *   o texto é barrado aqui; a FOTO (embalagem laranja, logo) é a IA que olha.
 */

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Título do anúncio da Shopee → produto do site (null = sem par). */
export function modeloDoAnuncio(titulo: string): string | null {
  const t = sem(titulo);
  const infantil = /infantil|menino|crianca|kids/.test(t);
  if (/bermuda d.?agua|shorts? (surf|tactel)|tactel/.test(t) && /short|bermuda/.test(t)) {
    return infantil ? 'Shorts Tactel Infantil' : 'Shorts Tactel com Ziper';
  }
  if (/(bermuda|short).*moletom|moletom.*(bermuda|short)/.test(t)) return 'Bermuda de Moletom';
  if (/calca.*moletom|moletom.*calca/.test(t)) return 'Calca de Moletom';
  if (/canguru|blusao.*capuz/.test(t)) return 'Moletom Canguru com Capuz';
  if (/ziper.*capuz|capuz.*ziper|jaqueta.*moletom/.test(t)) return 'Moletom com Ziper e Capuz';
  if (/gola careca/.test(t)) return 'Moletom Gola Careca';
  if (/termica|uv|protecao solar|dry.?fit/.test(t)) {
    if (infantil && /emborrachad/.test(t)) return 'Camiseta UV com Emborrachado';
    return /manga longa/.test(t) ? 'Camiseta UV Manga Longa' : 'Camiseta UV Manga Curta';
  }
  if (/regata/.test(t)) return 'Regata Basica';
  if (/camiseta|camisa/.test(t))
    return /manga longa/.test(t) ? 'Camiseta Basica Manga Longa' : 'Camiseta Basica Manga Curta';
  return null;
}

/** Nome comparável do produto do site (sem acento/maiúscula). */
export const chaveModelo = (nome: string) => sem(nome).replace(/\s+/g, ' ').trim();

/**
 * Cores da variação comprada ("Preto/Verde Militar", "Preto + Chumbo").
 * null = alguma cor não existe no cadastro (a avaliação fica de fora).
 */
export function coresDaVariacao(textoCor: string, coresDoModelo: string[]): string[] | null {
  const partes = textoCor
    .split(/\s*(?:\/|\+|,|\be\b)\s*/i)
    .map((s) => s.replace(/^\d+\s*/, '').trim())
    .filter(Boolean);
  if (!partes.length) return null;
  const doModelo = new Set(coresDoModelo);
  const out: string[] = [];
  for (const p of partes) {
    const c = corDoCadastro(p);
    if (!c || !doModelo.has(c)) return null;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** Texto que fala de marketplace, loja, entrega ou embalagem — não vai pro site. */
const PROIBIDO =
  /shopee|debex|mercado ?livre|\bml\b|marketplace|loja|vendedor|frete|entreg|chegou|chegaram|correio|transport|embalag|pacote|caixa|rastreio|envio|enviad|prazo|cupom|desconto|reembols|devolu/i;

export function textoLimpo(texto: string | null | undefined): boolean {
  const t = (texto ?? '').trim();
  return t.length >= 3 && !PROIBIDO.test(sem(t));
}

/** Avaliação candidata (antes da IA olhar a foto). */
export function candidata(c: {
  estrelas: number;
  texto: string | null | undefined;
  fotos: string[];
  oculta?: boolean;
}): boolean {
  return c.estrelas === 5 && c.fotos.length > 0 && !c.oculta && textoLimpo(c.texto);
}

export const PROMPT_TRIAGEM = `Você revisa fotos de avaliações de clientes que vão aparecer no site de uma confecção de roupas.

APROVE só se a foto mostra a peça de roupa (vestida, segurada ou estendida) de forma clara.
RECUSE se aparecer: embalagem/pacote/saco plástico (especialmente laranja), logo ou nome de marketplace (Shopee, Mercado Livre etc.), etiqueta de envio, caixa de transporte, print de tela, a peça não aparece, foto borrada demais, nudez ou algo impróprio.

Responda em JSON: {"aprovar": true|false, "motivo": "poucas palavras"}.`;

export const SCHEMA_TRIAGEM = {
  name: 'triagem_avaliacao',
  strict: true,
  schema: {
    type: 'object',
    properties: { aprovar: { type: 'boolean' }, motivo: { type: 'string' } },
    required: ['aprovar', 'motivo'],
    additionalProperties: false,
  },
};

/** Saída da IA; ilegível = recusa (na dúvida, não publica). */
export function lerTriagem(bruto: string): { aprovar: boolean; motivo: string } {
  try {
    const j = JSON.parse(bruto) as { aprovar?: unknown; motivo?: unknown };
    return { aprovar: j.aprovar === true, motivo: String(j.motivo ?? '').slice(0, 200) };
  } catch {
    return { aprovar: false, motivo: 'resposta da IA ilegível' };
  }
}
