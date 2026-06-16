import type { Canal } from './types';

export function fmtRelative(d: string | null | undefined): string {
  if (!d) return '';
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return '';
  const secs = Math.floor((Date.now() - t) / 1000);
  if (secs < 60) return 'agora';
  if (secs < 3600) return `${Math.floor(secs / 60)}min`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 172800) return 'ontem';
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`;
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/**
 * #25 fatia 2 — selo de SLA da lista: há quanto tempo o cliente espera.
 * Recebe a data ISO de `aguardandoDesde` e devolve texto curto + cor semântica
 * (verde até 30min, amarelo até 2h, vermelho acima). `null` quando não há nada
 * pendente (a chamadora não renderiza o selo nesse caso).
 */
export function slaBadge(
  aguardandoDesde: string | null | undefined,
): { texto: string; cor: string } | null {
  if (!aguardandoDesde) return null;
  const t = new Date(aguardandoDesde).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.floor((Date.now() - t) / 60000);
  const texto =
    min < 60
      ? `aguardando há ${Math.max(min, 0)}min`
      : min < 1440
        ? `aguardando há ${Math.floor(min / 60)}h`
        : `aguardando há ${Math.floor(min / 1440)}d`;
  const cor = min <= 30 ? 'var(--success)' : min <= 120 ? 'var(--warning)' : 'var(--danger)';
  return { texto, cor };
}

export function fmtTime(d: string) {
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

export function fmtHHMM(d: string) {
  try {
    return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return d;
  }
}

/**
 * #25 fatia 3 — formata segundos de "tempo médio de 1ª resposta" pra exibição
 * no painel de métricas. `null` → "—" (sem dado); senão escolhe a unidade mais
 * legível (segundos < 1min, minutos < 1h, horas+minutos acima).
 */
export function formatTempoResposta(s: number | null): string {
  if (s === null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}min`;
}

/**
 * Formata o "peer" (identificador do contato) pra exibição como TELEFONE.
 * No WhatsApp o peer vem como JID cru (ex: `5511988887777@s.whatsapp.net`).
 *
 * ⚠️ Atenção aos JIDs que NÃO são telefone:
 *  - `@lid`  → "número oculto" (privacidade do WhatsApp / Baileys). O número
 *    visível é um ID interno gigante, NÃO o telefone real → não exibimos.
 *  - `@g.us` → grupo. Também não tem telefone.
 * Nesses casos (e em IDs com tamanho implausível) retorna '' — quem chama
 * cai pro nome do contato / rótulo do canal em vez de mostrar número errado.
 *
 * Outros canais (marketplaces/redes) têm peer estruturado — retorna como está.
 */
export function fmtPeer(canal: Canal, peer: string | null | undefined): string {
  if (!peer) return '';
  if (canal !== 'WHATSAPP') return peer;
  const at = peer.indexOf('@');
  const suffix = at >= 0 ? peer.slice(at + 1).toLowerCase() : '';
  // LID (número oculto) e grupo não têm telefone real pra mostrar.
  if (suffix === 'lid' || suffix === 'g.us') return '';
  const digits = (at >= 0 ? peer.slice(0, at) : peer).replace(/\D/g, '');
  if (!digits) return '';
  // Brasil: 55 (país) + DDD (2) + número (8 ou 9 dígitos)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const num = digits.slice(4);
    return `+55 (${ddd}) ${num.slice(0, -4)}-${num.slice(-4)}`;
  }
  // Telefone internacional plausível (E.164 tem no máx. 15 dígitos).
  // Acima disso é quase certo um ID interno (ex: LID sem sufixo) → não exibe.
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
}
