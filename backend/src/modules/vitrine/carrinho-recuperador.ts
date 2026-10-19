import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Recuperador de carrinho (Léo, 14/10 — card cmv8ikbin0011pt5ie51wvco8). PURO.
 *
 * - O bot manda o link da vitrine com `?r=<ref>`: o ref é o id do lead +
 *   assinatura (HMAC), pra ninguém salvar carrinho em nome de outro lead.
 * - O link de recuperar abre a vitrine com `?c=<token>` (token aleatório do
 *   carrinho salvo) e restaura o carrinho + os dados do cliente.
 */

const chave = (segredo: string) =>
  createHmac('sha256', segredo).update('vitrine-ref-lead-v1').digest();

/** Ref público do lead pro link da vitrine: `<leadId>.<assinatura de 16>`. */
export function refDoLead(leadId: string, segredo: string): string {
  const ass = createHmac('sha256', chave(segredo)).update(leadId).digest('hex').slice(0, 16);
  return `${leadId}.${ass}`;
}

/** leadId do ref, ou null se a assinatura não bate (ref inventado/alterado). */
export function leadDoRef(ref: string | null | undefined, segredo: string): string | null {
  if (!ref) return null;
  const i = ref.lastIndexOf('.');
  if (i <= 0) return null;
  const leadId = ref.slice(0, i);
  if (!/^[a-z0-9]{10,40}$/i.test(leadId)) return null;
  const esperado = refDoLead(leadId, segredo);
  return esperado.length === ref.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(ref))
    ? leadId
    : null;
}

/**
 * Link que restaura o carrinho. Domínio próprio da vitrine: a raiz dele
 * (atacado.ribelt.com.br/?c=…); sem, o app com /v/<slug>.
 */
export function linkDoCarrinho(
  token: string,
  slug: string,
  dominio: string | null | undefined,
  frontendUrl: string | null | undefined,
): string {
  const d = dominio
    ?.trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (d) return `https://${d}/?c=${encodeURIComponent(token)}`;
  const base = (frontendUrl ?? '').replace(/\/+$/, '');
  return `${base}/v/${encodeURIComponent(slug)}?c=${encodeURIComponent(token)}`;
}

/** "Maria Clara Souza" → "Maria". */
export function primeiroNome(nome: string | null | undefined): string {
  const n = (nome ?? '').trim();
  // SEM nome (19/10): vazio, o placeholder "Contato 123456" que o WhatsApp
  // cria, ou só telefone/dígitos — senão a mensagem sai "Oi Contato".
  if (!n || /^contato\s*[\d\s()+-]*$/i.test(n) || /^[\d\s()+.-]+$/.test(n)) return '';
  return n.split(/\s+/)[0] ?? '';
}

/** 1234.5 → "R$ 1.234,50" (pra mensagem de WhatsApp). */
export function reais(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Quanto tempo parado até disparar, e até quando ainda vale avisar. */
export const ESPERA_MIN = 20;
export const VALIDADE_HORAS = 24;
