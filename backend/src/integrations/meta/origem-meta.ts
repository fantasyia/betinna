import { z } from 'zod';

/**
 * Origem do lead do Meta (card cmvl673p6, 23/10). A Ribelt usa UM formulário
 * instantâneo pra todas as campanhas, então o formulário não diz de onde o lead
 * veio — o ANÚNCIO diz. Aqui mora o que é PURO: o bloco `variaveis.meta`, o
 * produto da campanha e o link que o F02 manda. Quem consulta a Graph API e o
 * banco é o `MetaLeadgenService`.
 */

/** Gravado em `Lead.variaveis.meta` — vira `{{lead.meta.*}}` nos fluxos. */
export interface OrigemMeta {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  form_id?: string;
  /** `fb` | `ig` (como o Meta manda). */
  platform?: string;
  /** Slug do produto da campanha (vazio = campanha geral). */
  produto_slug?: string;
  /** Link que o F02 manda: o do produto, ou o geral da vitrine. */
  link?: string;
}

/** O que a Graph API devolve (lead e anúncio), já achatado. */
export interface DadosOrigem {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
}

/** Junta as fontes: a primeira que tiver o campo ganha. Campo vazio não entra. */
export function origemMeta(...fontes: Array<DadosOrigem | null | undefined>): OrigemMeta {
  const out: OrigemMeta = {};
  const chaves: Array<keyof DadosOrigem> = [
    'campaign_id',
    'campaign_name',
    'adset_id',
    'adset_name',
    'ad_id',
    'ad_name',
    'form_id',
    'platform',
  ];
  for (const k of chaves) {
    for (const f of fontes) {
      const v = f?.[k];
      if (typeof v === 'string' && v.trim()) {
        out[k] = v.trim();
        break;
      }
    }
  }
  return out;
}

/**
 * Lead criado pela ferramenta de teste do Meta (developers.facebook.com/tools/lead-ads-testing):
 * os campos chegam como `<test lead: dummy data for full_name>`. Ganha a
 * etiqueta `teste` e nenhum fluxo fala com ele.
 */
export function ehLeadDeTesteMeta(campos: Record<string, string>): boolean {
  return Object.values(campos).some((v) => /<\s*test lead/i.test(v));
}

/** Etiqueta que tira o lead dos fluxos (o bus não acende fluxo pra ele). */
export { TAG_LEAD_TESTE as TAG_TESTE } from '@modules/fluxos/lead-acelerado';

// ─── Mapa campanha → produto ─────────────────────────────────────────

/** `Empresa.config.metaCampanhas` — mantido pela sessão de ads pelo MCP. */
export interface CampanhaProduto {
  /** ID da campanha OU o nome exato (sem diferença de maiúscula). */
  campanha: string;
  /** Slug do produto; vazio = campanha geral (manda o link da vitrine). */
  slug: string;
}

export const campanhasMetaSchema = z.object({
  campanhas: z
    .array(
      z.object({
        campanha: z.string().trim().min(1).max(200),
        slug: z
          .string()
          .trim()
          .max(80)
          .regex(/^[a-z0-9-]*$/, 'slug só com a-z, 0-9 e hífen'),
      }),
    )
    .max(200),
});
export type CampanhasMetaDto = z.infer<typeof campanhasMetaSchema>;

export function campanhasMeta(config: unknown): CampanhaProduto[] {
  const lista = ((config ?? {}) as { metaCampanhas?: unknown }).metaCampanhas;
  if (!Array.isArray(lista)) return [];
  return lista.filter(
    (x): x is CampanhaProduto =>
      !!x &&
      typeof (x as CampanhaProduto).campanha === 'string' &&
      typeof (x as CampanhaProduto).slug === 'string',
  );
}

/**
 * Produto da campanha. Ordem:
 *  1. o mapa (por ID ou nome exato da campanha) — decide até "campanha geral";
 *  2. a regra do nome: o slug de um produto escrito no nome da campanha, do
 *     conjunto ou do anúncio (ex.: `UV adulto · camiseta-uv-raglan-manga-longa`).
 *     O mais longo ganha (`camiseta-uv` não rouba `camiseta-uv-raglan`).
 * `slugs` = mapa slug (atual ou antigo) → slug atual dos produtos ATIVOS.
 * Slug do mapa que não é produto ativo cai pro link geral.
 */
export function produtoDaCampanha(
  origem: OrigemMeta,
  mapa: CampanhaProduto[],
  slugs: Map<string, string>,
): string | null {
  const id = origem.campaign_id?.toLowerCase();
  const nome = origem.campaign_name?.trim().toLowerCase();
  const doMapa = mapa.find((m) => {
    const c = m.campanha.trim().toLowerCase();
    return (id && c === id) || (nome && c === nome);
  });
  if (doMapa) return doMapa.slug ? (slugs.get(doMapa.slug) ?? null) : null;

  const textos = [origem.campaign_name, origem.adset_name, origem.ad_name]
    .filter((t): t is string => !!t)
    .map((t) => t.toLowerCase());
  for (const texto of textos) {
    let melhor: string | null = null;
    for (const s of slugs.keys()) {
      if (contemSlug(texto, s) && (!melhor || s.length > melhor.length)) melhor = s;
    }
    if (melhor) return slugs.get(melhor) ?? null;
  }
  return null;
}

/** O slug aparece inteiro (não como pedaço de outra palavra). */
function contemSlug(texto: string, slug: string): boolean {
  const i = texto.indexOf(slug);
  if (i < 0) return false;
  const antes = i === 0 ? '' : texto[i - 1];
  const depois = texto[i + slug.length] ?? '';
  return !/[a-z0-9-]/.test(antes) && !/[a-z0-9-]/.test(depois);
}

/**
 * Link que o F02 manda: `https://<domínio>/p/<slug>?utm_source=meta&utm_medium=lead&utm_campaign=<campanha>`,
 * ou a raiz da vitrine com os mesmos UTMs. Sem domínio próprio → vazio (o
 * fluxo usa o texto de reserva dele).
 */
export function linkDaOrigem(
  dominio: string | null | undefined,
  slug: string | null,
  campanha: string | null | undefined,
): string {
  const d = dominio
    ?.trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (!d) return '';
  const qs = new URLSearchParams({ utm_source: 'meta', utm_medium: 'lead' });
  if (campanha?.trim()) qs.set('utm_campaign', campanha.trim());
  return `https://${d}${slug ? `/p/${slug}` : '/'}?${qs}`;
}
