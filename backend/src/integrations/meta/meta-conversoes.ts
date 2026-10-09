import { createHash } from 'node:crypto';

/**
 * API de Conversões do Meta (CAPI) — montagem PURA do evento de compra.
 *
 * Card da #04 (09/10): pixel no navegador + CAPI no servidor, com o MESMO
 * `event_id` nos dois (o Meta junta e conta uma vez). A compra só existe de
 * verdade quando o pedido é PAGO — por isso o Purchase sai do servidor.
 *
 * Dados do cliente vão com SHA-256, normalizados como o Meta pede: minúsculo,
 * sem espaço nas pontas; telefone só dígitos COM o código do país; cidade sem
 * espaço; UF 2 letras; CEP só dígitos; país "br". `fbc`/`fbp`, IP e navegador
 * vão crus (o Meta exige assim).
 */

export const sha256 = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');

/** Normaliza e cifra; vazio → undefined (campo não vai). */
function h(v: string | null | undefined, normalizar: (s: string) => string): string | undefined {
  if (!v) return undefined;
  const n = normalizar(v);
  return n ? sha256(n) : undefined;
}

const minusculo = (s: string) => s.trim().toLowerCase();
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Telefone BR: só dígitos, com 55 na frente (10–11 dígitos ganham o 55). */
export function telefoneMeta(t: string): string {
  const d = t.replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

export interface CompraCapi {
  pedidoId: string;
  numero: string;
  total: number;
  pagoEm: Date;
  telefone: string | null;
  email: string | null;
  nome: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  clienteId: string | null;
  itens: Array<{ produtoId: string; quantidade: number; preco: number }>;
  /** Página onde o pedido foi feito (exigida pra evento de site). */
  url: string;
  ip: string | null;
  userAgent: string;
  fbc: string | null;
  fbp: string | null;
}

/** `event_id` do Purchase — o navegador manda o mesmo, e o Meta deduplica. */
export const eventoCompraId = (pedidoId: string) => `pedido-${pedidoId}`;

export function eventoCompra(c: CompraCapi) {
  const primeiroNome = c.nome?.trim().split(/\s+/)[0] ?? null;
  const user_data: Record<string, unknown> = {
    ph: h(c.telefone, (s) => telefoneMeta(s)),
    em: h(c.email, minusculo),
    fn: h(primeiroNome, (s) => semAcento(minusculo(s))),
    ct: h(c.cidade, (s) => semAcento(minusculo(s)).replace(/[^a-z]/g, '')),
    st: h(c.uf, (s) => minusculo(s).slice(0, 2)),
    zp: h(c.cep, (s) => s.replace(/\D/g, '')),
    country: sha256('br'),
    external_id: h(c.clienteId, minusculo),
    client_ip_address: c.ip ?? undefined,
    client_user_agent: c.userAgent,
    fbc: c.fbc ?? undefined,
    fbp: c.fbp ?? undefined,
  };
  for (const k of Object.keys(user_data)) if (user_data[k] === undefined) delete user_data[k];
  return {
    event_name: 'Purchase',
    event_time: Math.floor(c.pagoEm.getTime() / 1000),
    event_id: eventoCompraId(c.pedidoId),
    action_source: 'website',
    event_source_url: c.url,
    user_data,
    custom_data: {
      currency: 'BRL',
      value: Math.round(c.total * 100) / 100,
      order_id: c.numero,
      content_type: 'product',
      contents: c.itens.map((i) => ({
        id: i.produtoId,
        quantity: i.quantidade,
        item_price: i.preco,
      })),
      num_items: c.itens.reduce((s, i) => s + i.quantidade, 0),
    },
  };
}
