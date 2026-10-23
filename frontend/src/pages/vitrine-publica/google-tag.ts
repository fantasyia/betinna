/**
 * Tag do Google na vitrine (card cmv8rfj43000knz5igb2y3ws2 — #04/Léo, 15/10):
 * GA4 + Google Ads com o MESMO gtag.js. Os eventos são os do pixel do Meta,
 * traduzidos pros nomes do GA4; a compra também vai como conversão do Ads,
 * com e-mail/telefone (conversões otimizadas) e `transaction_id` = pedido.
 */

export interface GoogleTag {
  /** GA4 (G-XXXX). null = só Ads. */
  ga4Id: string | null;
  /** Google Ads (AW-123). null = só GA4. */
  adsId: string | null;
  /** `AW-123/rotulo` da conversão de compra. null = Ads sem conversão de compra. */
  compraSendTo: string | null;
}

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

let tag: GoogleTag | null = null;

/**
 * Carrega o gtag.js (uma vez) e configura o GA4 e o Ads. O GA4 manda o
 * page_view sozinho. `interno` (equipe, 19/10): GA4 com traffic_type=internal
 * (o filtro descarta) e SEM Google Ads — nem config, nem conversão.
 */
export function iniciarGoogleTag(t0: GoogleTag, opts: { interno?: boolean } = {}): void {
  const t: GoogleTag = opts.interno ? { ...t0, adsId: null, compraSendTo: null } : t0;
  if (typeof window === 'undefined' || tag || (!t.ga4Id && !t.adsId)) return;
  window.dataLayer = window.dataLayer ?? [];
  if (!window.gtag) {
    // O snippet oficial: a função só empilha `arguments` até o script chegar.
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent((t.ga4Id ?? t.adsId)!)}`;
    document.head.appendChild(s);
  }
  window.gtag('js', new Date());
  if (t.ga4Id) {
    if (opts.interno) window.gtag('config', t.ga4Id, { traffic_type: 'internal' });
    else window.gtag('config', t.ga4Id);
  }
  if (t.adsId) window.gtag('config', t.adsId, { allow_enhanced_conversions: true });
  tag = t;
}

function gtag(...args: unknown[]): void {
  if (tag && window.gtag) window.gtag(...args);
}

const NOMES: Record<string, string> = {
  ViewContent: 'view_item',
  AddToCart: 'add_to_cart',
  InitiateCheckout: 'begin_checkout',
  AddPaymentInfo: 'add_payment_info',
};

/**
 * O evento do pixel (nome e parâmetros do Meta) no formato do GA4. A compra
 * NÃO passa aqui: sai por `compraGoogle`, que tem e-mail e cliente novo.
 */
export function espelharEvento(nomeMeta: string, p: Record<string, unknown> = {}): void {
  const nome = NOMES[nomeMeta];
  if (!nome || !tag) return;
  const ids = (p.content_ids as string[] | undefined) ?? [];
  const params: Record<string, unknown> = { currency: 'BRL' };
  if (typeof p.value === 'number') params.value = p.value;
  if (ids.length) {
    params.items = ids.map((id) => ({
      item_id: id,
      ...(p.content_name ? { item_name: p.content_name } : {}),
      ...(typeof p.num_items === 'number' ? { quantity: p.num_items } : {}),
    }));
  }
  gtag('event', nome, params);
}

/** Telefone em E.164 (o Google pede assim pra conversão otimizada). */
export function telefoneE164(whats: string): string | undefined {
  const d = whats.replace(/\D/g, '');
  if (d.length < 10) return undefined;
  return `+${d.startsWith('55') && d.length >= 12 ? d : `55${d}`}`;
}

/** Compra paga: `purchase` no GA4 e a conversão de compra no Ads (mesmo transaction_id). */
export function compraGoogle(c: {
  pedidoId: string;
  total: number;
  pecas: number;
  email?: string | null;
  whatsapp?: string | null;
  clienteNovo?: boolean | null;
}): void {
  if (!tag) return;
  const email = c.email?.trim().toLowerCase() || undefined;
  const phone = c.whatsapp ? telefoneE164(c.whatsapp) : undefined;
  if (email || phone) {
    gtag('set', 'user_data', { ...(email ? { email } : {}), ...(phone ? { phone_number: phone } : {}) });
  }
  const novo = typeof c.clienteNovo === 'boolean' ? { new_customer: c.clienteNovo } : {};
  if (tag.ga4Id) {
    gtag('event', 'purchase', {
      send_to: tag.ga4Id,
      transaction_id: c.pedidoId,
      value: c.total,
      currency: 'BRL',
      items: [{ item_id: 'pedido', item_name: 'Pedido de atacado', quantity: c.pecas }],
      ...novo,
    });
  }
  if (tag.compraSendTo) {
    gtag('event', 'conversion', {
      send_to: tag.compraSendTo,
      transaction_id: c.pedidoId,
      value: c.total,
      currency: 'BRL',
      ...novo,
    });
  }
}

/** Só pros testes. */
export function _resetarGoogleTag(): void {
  tag = null;
}

/**
 * Trocou de produto no feed e a URL virou /p/<outro> (23/10): page_view do
 * GA4 com o endereço novo. O view_item continua sendo o da ficha/grade aberta.
 */
export function paginaVista(url: string, titulo: string): void {
  if (!tag?.ga4Id) return;
  gtag('event', 'page_view', { page_location: url, page_title: titulo, send_to: tag.ga4Id });
}
