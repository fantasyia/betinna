/**
 * Normalização + sanitização dos dados de ATRIBUIÇÃO de marketing (UTM etc).
 *
 * Esses valores vêm da querystring do navegador — controlados por quem clica no
 * link — e depois são renderizados em relatório HTML. Duas defesas na INGESTÃO:
 *  - NORMALIZAR (lower+trim) source/medium/campaign/origem/formulario → "Google",
 *    "google" e "GOOGLE " colapsam num grupo só no relatório.
 *  - SANITIZAR (strip de controle + corte de tamanho) TODOS os campos de texto →
 *    corta o vetor de XSS na porta de entrada (além do escape no render).
 *
 * ⚠️ gclid/fbclid são case-SENSITIVE (lowercase os quebra) e landingPage/referrer
 * são URLs — esses levam só trim+sanitize, NUNCA lowercase.
 */

const LIMITE = 255;

const CONTROLE = /[\x00-\x1F\x7F]/g;

const ORIGENS_VALIDAS = [
  'site',
  'meta_lead_ads',
  'google_lead_form',
  'importacao',
  'manual_rep',
  'whatsapp',
  'api',
] as const;
export type OrigemCadastro = (typeof ORIGENS_VALIDAS)[number];

/** trim + remove caracteres de controle + corta em LIMITE. Vazio → undefined. */
function sanitizar(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(CONTROLE, '').trim().slice(0, LIMITE);
  return s.length ? s : undefined;
}

/** sanitizar + lowercase (agrupadores: source/medium/campaign/origem/formulario). */
function sanitizarLower(v: unknown): string | undefined {
  return sanitizar(v)?.toLowerCase();
}

export interface AtribuicaoBloco {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  gclid?: string;
  fbclid?: string;
  landingPage?: string;
  referrer?: string;
  capturadoEm?: string;
}

export interface Atribuicao {
  primeiro?: AtribuicaoBloco;
  ultimo?: AtribuicaoBloco;
}

/** Limpa 1 bloco (primeiro OU último). Vazio → undefined. */
function normalizarBloco(bloco: unknown): AtribuicaoBloco | undefined {
  if (!bloco || typeof bloco !== 'object') return undefined;
  const b = bloco as Record<string, unknown>;
  const out: AtribuicaoBloco = {
    // agrupadores → lower
    utmSource: sanitizarLower(b.utmSource),
    utmMedium: sanitizarLower(b.utmMedium),
    utmCampaign: sanitizarLower(b.utmCampaign),
    // preservam caixa
    utmContent: sanitizar(b.utmContent),
    utmTerm: sanitizar(b.utmTerm),
    gclid: sanitizar(b.gclid),
    fbclid: sanitizar(b.fbclid),
    landingPage: sanitizar(b.landingPage),
    referrer: sanitizar(b.referrer),
    capturadoEm: sanitizar(b.capturadoEm),
  };
  for (const k of Object.keys(out) as (keyof AtribuicaoBloco)[]) {
    if (out[k] === undefined) delete out[k];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Normaliza o bloco de atribuição inteiro. Tudo vazio → undefined. */
export function normalizarAtribuicao(atrib: unknown): Atribuicao | undefined {
  if (!atrib || typeof atrib !== 'object') return undefined;
  const a = atrib as Record<string, unknown>;
  const primeiro = normalizarBloco(a.primeiro);
  const ultimo = normalizarBloco(a.ultimo);
  if (!primeiro && !ultimo) return undefined;
  const out: Atribuicao = {};
  if (primeiro) out.primeiro = primeiro;
  if (ultimo) out.ultimo = ultimo;
  return out;
}

/**
 * origemCadastro: lower + valida por LISTA. Fora da lista OU ausente → fallback
 * (NÃO derruba o lead por causa disso). Público → fallback "site".
 */
export function normalizarOrigemCadastro(
  v: unknown,
  fallback: OrigemCadastro = 'site',
): OrigemCadastro {
  const s = sanitizarLower(v);
  return (ORIGENS_VALIDAS as readonly string[]).includes(s ?? '')
    ? (s as OrigemCadastro)
    : fallback;
}

/** formulario: lower + sanitize (VARCHAR livre — form novo não exige deploy). */
export function normalizarFormulario(v: unknown): string | undefined {
  return sanitizarLower(v)?.slice(0, 40);
}

/**
 * Colunas indexáveis do PRIMEIRO toque (o que credita a campanha e é consultado).
 * Extraídas de `primeiro`; `ultimo` inteiro mora no JSON.
 */
export function colunasPrimeiroToque(atrib?: Atribuicao): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
} {
  const p = atrib?.primeiro;
  return {
    utmSource: p?.utmSource ?? null,
    utmMedium: p?.utmMedium ?? null,
    utmCampaign: p?.utmCampaign ?? null,
  };
}
