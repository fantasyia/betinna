/**
 * Lead Ads (formulário nativo do Meta) — tipos do webhook `leadgen` e da busca
 * na Graph API.
 *
 * O Meta NÃO manda os dados do lead no webhook: manda só o `leadgen_id`. Os
 * dados vêm de um `GET /{leadgen_id}` feito depois, com `leads_retrieval`. Por
 * isso o caminho é webhook → fila → busca → cria lead, e não webhook → cria.
 */

/** Fila da busca dos dados do lead na Graph API (o webhook só enfileira). */
export const META_LEADGEN_QUEUE = 'meta-leadgen';

/** O que o webhook `leadgen` entrega — nenhum dado pessoal, só ponteiros. */
export interface MetaLeadgenChangeValue {
  leadgen_id: string;
  page_id: string;
  form_id: string;
  /** Só existe quando o formulário veio de um anúncio (orgânico não tem). */
  ad_id?: string;
  adgroup_id?: string;
  created_time?: number;
}

export interface MetaLeadgenJobData {
  empresaId: string;
  leadgenId: string;
  pageId: string;
  formId?: string;
  adId?: string;
  adgroupId?: string;
  /** epoch em SEGUNDOS (padrão do Meta). */
  createdTime?: number;
}

/** Resposta do `GET /{leadgen_id}`. */
export interface MetaLeadgenDados {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: Array<{ name: string; values: string[] }>;
}

/** Resposta do `GET /{ad_id}?fields=name,campaign{name},adset{name}`. */
export interface MetaAnuncio {
  id: string;
  name?: string;
  campaign?: { id?: string; name?: string };
  adset?: { id?: string; name?: string };
}
