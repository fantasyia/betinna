/**
 * Pixel do Meta na vitrine + a campanha de onde o cliente veio (card da #04,
 * 09/10). Sem aviso de consentimento (decisão do Léo, 09/10): a Política de
 * Privacidade explica o pixel quando ele está ligado.
 *
 * O Purchase de verdade sai do SERVIDOR (API de Conversões) quando o pedido
 * vira PAGO; o do navegador leva o MESMO `eventID` (`pedido-<id>`) e o Meta
 * junta os dois.
 */

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
};
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

import { espelharEvento } from './google-tag';

let iniciado: string | null = null;

/** Carrega o fbevents.js (uma vez), inicia o pixel e manda o PageView. */
export function iniciarPixel(pixelId: string): void {
  if (iniciado === pixelId || typeof window === 'undefined') return;
  if (!window.fbq) {
    // O "snippet" oficial do Meta, sem minificar: fila até o script chegar.
    const fbq: Fbq = (...args: unknown[]) => {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue!.push(args);
    };
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    window.fbq = fbq;
    window._fbq = fbq;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
  }
  window.fbq('init', pixelId);
  window.fbq('track', 'PageView');
  iniciado = pixelId;
}

/**
 * Evento padrão do Meta. Sem pixel iniciado, não faz nada no Meta — mas vai
 * pro GA4 do mesmo jeito (tag do Google, 15/10), que é independente.
 */
export function evento(nome: string, params: Record<string, unknown> = {}, eventID?: string): void {
  espelharEvento(nome, params);
  if (!iniciado || !window.fbq) return;
  if (eventID) window.fbq('track', nome, params, { eventID });
  else window.fbq('track', nome, params);
}

/**
 * Correspondência avançada (#04, 15/10): e-mail e telefone que o cliente
 * digitou vão no `init` de novo — o fbevents.js cifra (hash) antes de enviar.
 */
export function dadosDoCliente(c: { email?: string | null; whatsapp?: string | null }): void {
  if (!iniciado || !window.fbq) return;
  const em = c.email?.trim().toLowerCase() || undefined;
  const d = (c.whatsapp ?? '').replace(/\D/g, '');
  const ph = d.length >= 10 ? (d.startsWith('55') && d.length >= 12 ? d : `55${d}`) : undefined;
  if (!em && !ph) return;
  window.fbq('init', iniciado, { ...(em ? { em } : {}), ...(ph ? { ph } : {}) });
}

/**
 * Compra do navegador UMA vez por pedido neste aparelho (#04, 15/10: 4 do
 * navegador pra 2 pedidos). Sem armazenamento, deixa passar.
 */
export function primeiraCompra(pedidoId: string): boolean {
  const k = `vitrine:compra:${pedidoId}`;
  try {
    if (localStorage.getItem(k)) return false;
    localStorage.setItem(k, new Date().toISOString());
  } catch {
    /* sem armazenamento: o eventID igual ainda deduplica no Meta */
  }
  return true;
}

/**
 * "Começou o checkout" uma vez por carrinho na sessão: abrir e fechar o
 * "Enviar pedido" com o mesmo carrinho não conta de novo (#04, 15/10).
 */
export function primeiroCheckout(slug: string, assinatura: string): boolean {
  const k = `vitrine:checkout:${slug}`;
  try {
    if (sessionStorage.getItem(k) === assinatura) return false;
    sessionStorage.setItem(k, assinatura);
  } catch {
    /* sem armazenamento: conta toda vez, como antes */
  }
  return true;
}

/** Só pros testes. */
export function _resetarPixel(): void {
  iniciado = null;
}

// ─── De onde o cliente veio ────────────────────────────────────────────────

export interface Toque {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  gclid?: string;
  /** Cliques do Google Ads vindos de iOS (app/web): o gclid deles (15/10). */
  gbraid?: string;
  wbraid?: string;
  landingPage?: string;
  referrer?: string;
  capturadoEm?: string;
}

const CHAVE = 'vitrine:atribuicao';
/** Primeiro contato vale por 30 dias; depois, o próximo acesso vira o "primeiro". */
const PRIMEIRO_MS = 30 * 86_400_000;

const PARAMS: Array<[keyof Toque, string]> = [
  ['utmSource', 'utm_source'],
  ['utmMedium', 'utm_medium'],
  ['utmCampaign', 'utm_campaign'],
  ['utmContent', 'utm_content'],
  ['utmTerm', 'utm_term'],
  ['fbclid', 'fbclid'],
  ['gclid', 'gclid'],
  ['gbraid', 'gbraid'],
  ['wbraid', 'wbraid'],
];

function ler(): { primeiro?: Toque; ultimo?: Toque } {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as { primeiro?: Toque; ultimo?: Toque };
  } catch {
    return {};
  }
}

/**
 * Guarda o toque desta visita: o PRIMEIRO (30 dias) e o ÚLTIMO que veio de
 * campanha. Visita sem parâmetro de campanha não apaga o último.
 */
export function capturarAtribuicao(href: string, referrer: string, agora = new Date()): void {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  const toque: Toque = {};
  for (const [k, p] of PARAMS) {
    const v = url.searchParams.get(p);
    if (v) toque[k] = v.slice(0, 500);
  }
  const deCampanha = Object.keys(toque).length > 0;
  toque.landingPage = href.slice(0, 2000);
  if (referrer) toque.referrer = referrer.slice(0, 2000);
  toque.capturadoEm = agora.toISOString();

  const atual = ler();
  const primeiroVencido =
    !atual.primeiro?.capturadoEm ||
    agora.getTime() - new Date(atual.primeiro.capturadoEm).getTime() > PRIMEIRO_MS;
  const novo = {
    primeiro: primeiroVencido ? toque : atual.primeiro,
    ultimo: deCampanha ? toque : atual.ultimo,
  };
  try {
    localStorage.setItem(CHAVE, JSON.stringify(novo));
  } catch {
    /* sem armazenamento: o pedido vai sem campanha */
  }
}

function cookie(nome: string): string | undefined {
  const m = document.cookie.match(new RegExp(`(?:^|; )${nome}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

/** O que vai no pedido: campanha + cookies do Meta (`_fbc`/`_fbp`). */
export function atribuicaoParaEnvio(paginaAtual: string): {
  primeiro?: Toque;
  ultimo?: Toque;
  fbc?: string;
  fbp?: string;
  gaClientId?: string;
} {
  const a = ler();
  // Sem toque de campanha, o "último" é a página do pedido (o Meta pede a URL do evento).
  const ultimo = a.ultimo ?? { landingPage: paginaAtual.slice(0, 2000), capturadoEm: new Date().toISOString() };
  let fbc = cookie('_fbc');
  const clique = a.ultimo?.fbclid ?? a.primeiro?.fbclid;
  if (!fbc && clique) {
    // Formato oficial quando o cookie ainda não existe: fb.1.<ms do clique>.<fbclid>.
    const quando = new Date(a.ultimo?.capturadoEm ?? a.primeiro?.capturadoEm ?? Date.now()).getTime();
    fbc = `fb.1.${quando}.${clique}`;
  }
  return {
    ...(a.primeiro ? { primeiro: a.primeiro } : {}),
    ultimo,
    ...(fbc ? { fbc } : {}),
    ...(cookie('_fbp') ? { fbp: cookie('_fbp') } : {}),
    ...(gaClientId() ? { gaClientId: gaClientId() } : {}),
  };
}

/** `_ga` = GA1.1.<id>.<ts> → o client_id do GA4 é "<id>.<ts>". */
function gaClientId(): string | undefined {
  const m = cookie('_ga')?.match(/^GA\d\.\d\.(\d+\.\d+)$/);
  return m ? m[1] : undefined;
}

