/**
 * Vocabulário de ORIGEM do lead pra tela — espelho de
 * `backend/src/shared/utils/origem-lead.ts` (que o gatilho LEAD_CRIADO usa).
 *
 * O campo é VARCHAR no banco, não enum: porta nova de captura não pode exigir
 * migration. Então aqui só tem RÓTULO — nada depende desta lista pra funcionar.
 * Origem desconhecida cai no fallback (`rotuloOrigem`) e continua aparecendo na
 * tela em vez de sumir.
 */

export const ORIGENS_INBOUND = [
  'site',
  'whatsapp',
  'click_to_whatsapp',
  'meta_lead_ads',
  'google_lead_form',
] as const;

export const ORIGENS_OUTBOUND = ['importacao', 'manual_rep'] as const;

/** `api` fica fora dos dois grupos — pode ser parceiro (inbound) ou carga (outbound). */
export const ORIGENS_SEM_GRUPO = ['api'] as const;

export const ROTULO_ORIGEM: Record<string, string> = {
  site: 'Site',
  whatsapp: 'WhatsApp',
  click_to_whatsapp: 'Anúncio → WhatsApp',
  meta_lead_ads: 'Meta Lead Ads',
  google_lead_form: 'Google Lead Form',
  importacao: 'Importação',
  manual_rep: 'Cadastro do rep',
  api: 'API',
};

export const ROTULO_FORMULARIO: Record<string, string> = {
  contato: 'Fale conosco',
  representante: 'Seja representante',
  amostra: 'Pedir amostra',
  calculadora: 'Calculadora',
  seletor: 'Seletor de produto',
};

export const FORMULARIOS_ORIGEM = Object.keys(ROTULO_FORMULARIO);

/** Rótulo legível; valor desconhecido volta humanizado (`porta_nova` → "Porta nova"). */
export function rotuloOrigem(v: string | null | undefined): string | null {
  if (!v) return null;
  const chave = v.trim().toLowerCase();
  if (!chave) return null;
  return (
    ROTULO_ORIGEM[chave] ??
    chave.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
  );
}

export function rotuloFormulario(v: string | null | undefined): string | null {
  if (!v) return null;
  const chave = v.trim().toLowerCase();
  if (!chave) return null;
  return (
    ROTULO_FORMULARIO[chave] ??
    chave.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
  );
}
