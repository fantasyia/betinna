/**
 * Extrai a ATRIBUIÇÃO de anúncio Click-to-WhatsApp (CTWA) do proto do Baileys.
 *
 * Quando alguém clica num anúncio CTWA e abre a conversa, o Meta anexa o referral
 * do anúncio à PRIMEIRA mensagem — e só a ela. Se não capturar ali, perde (mesma
 * irreversibilidade da UTM do site).
 *
 * ⚠️ IMPORTANTE — o que dá pra garantir hoje: o `ctwa_clid` "oficial" é campo da
 * Cloud API do WhatsApp (objeto `referral` do webhook). No protocolo WhatsApp Web
 * (Baileys/Evolution, que é o provider daqui) o que chega é
 * `message.*.contextInfo.externalAdReply` — e o `ctwaClid` PODE ou NÃO vir,
 * dependendo da versão. Por isso: lemos o que existir, guardamos o bloco CRU
 * (`raw`) pra não perder nada, e o `ctwaClid` é OPCIONAL. A validação final é com
 * payload real de anúncio no ar (conta de anúncios + WhatsApp de produção).
 */

/** Referral de anúncio, normalizado. Todos os campos opcionais de propósito. */
export interface CtwaReferral {
  /** Identificador do clique (Cloud API garante; no Web pode não vir). */
  ctwaClid?: string;
  /** Id do anúncio/campanha na origem. */
  sourceId?: string;
  sourceType?: string;
  sourceUrl?: string;
  /** Título/corpo do criativo — útil pra reconhecer a campanha a olho. */
  headline?: string;
  body?: string;
  /** Bloco cru do externalAdReply, pra não perder campo que a gente não mapeou. */
  raw?: Record<string, unknown>;
}

const LIMITE = 500;

function texto(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;

  const s = v
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, LIMITE);
  return s.length ? s : undefined;
}

/**
 * Varre o `proto.IMessage` procurando um `contextInfo.externalAdReply`. O
 * contextInfo pode estar em qualquer variante da mensagem (extendedTextMessage,
 * imageMessage, videoMessage…), então procuramos em todas em vez de fixar uma.
 */
export function extrairCtwaReferral(message: unknown): CtwaReferral | undefined {
  if (!message || typeof message !== 'object') return undefined;

  let ad: Record<string, unknown> | undefined;
  for (const variante of Object.values(message as Record<string, unknown>)) {
    if (!variante || typeof variante !== 'object') continue;
    const ctx = (variante as Record<string, unknown>).contextInfo;
    if (!ctx || typeof ctx !== 'object') continue;
    const ear = (ctx as Record<string, unknown>).externalAdReply;
    if (ear && typeof ear === 'object') {
      ad = ear as Record<string, unknown>;
      break;
    }
  }
  if (!ad) return undefined;

  const ref: CtwaReferral = {
    // `ctwaClid` aparece com nomes diferentes conforme a versão do Baileys.
    ctwaClid: texto(ad.ctwaClid) ?? texto(ad.ctwa_clid),
    sourceId: texto(ad.sourceId) ?? texto(ad.source_id),
    sourceType: texto(ad.sourceType) ?? texto(ad.source_type),
    sourceUrl: texto(ad.sourceUrl) ?? texto(ad.source_url),
    headline: texto(ad.title) ?? texto(ad.headline),
    body: texto(ad.body),
  };
  for (const k of Object.keys(ref) as (keyof CtwaReferral)[]) {
    if (ref[k] === undefined) delete ref[k];
  }
  // Sem NENHUM campo útil → não inventa atribuição.
  if (Object.keys(ref).length === 0) return undefined;
  ref.raw = ad;
  return ref;
}

/**
 * Slug de campanha a partir do referral. Convenção já adotada no card de
 * atribuição: o NOME da campanha no Meta é o slug. No Web só temos o título do
 * criativo/sourceId — então normalizamos o que houver (lower+trim), e o
 * mapeamento fino (sourceId → nome da campanha via Graph API) fica pra quando
 * houver credencial do Meta. Sem isso, `utmCampaign` fica indefinido e a conversa
 * ainda guarda o referral cru pra reprocessar depois.
 */
export function campanhaDoReferral(ref?: CtwaReferral): string | undefined {
  if (!ref) return undefined;
  const bruto = ref.headline ?? ref.sourceId;
  return bruto ? bruto.toLowerCase().slice(0, 255) : undefined;
}
