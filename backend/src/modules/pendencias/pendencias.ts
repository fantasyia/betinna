/**
 * Pendências de marketplace (Léo, 24/10; card cmvly8hf1). O que precisa da
 * LOJA: pergunta/mensagem de comprador sem resposta ESCRITA, reclamação ou
 * devolução esperando a loja. A rotina de hora em hora pergunta à API de cada
 * marketplace (não ao inbox: resposta dada pelo app do marketplace não aparece
 * aqui) e avisa UMA vez por item, com 1 lembrete se o prazo ficar < 24 h. PURO.
 */

export type TipoPendencia = 'PERGUNTA' | 'MENSAGEM' | 'RECLAMACAO' | 'DEVOLUCAO';

export interface PendenciaAchada {
  canal: string;
  tipo: TipoPendencia;
  /** Id externo estável (pergunta, conversa, incidente). */
  chave: string;
  titulo: string;
  detalhe?: string | null;
  link?: string | null;
  desde?: Date | null;
  prazo?: Date | null;
  comprador?: string | null;
  pedido?: string | null;
  anuncio?: string | null;
}

/** Filtro de status da aba (24/10). ABERTAS = tudo que não foi encerrado. */
export const STATUS_PENDENCIA = [
  'ABERTAS',
  'PENDENTE',
  'AGUARDANDO_HUMANO',
  'RESPONDIDA_IA',
  'ENCERRADA',
] as const;
export type StatusPendencia = (typeof STATUS_PENDENCIA)[number];

/** Status de UMA pendência, pro rótulo e pra contagem. */
export function statusDa(p: {
  resolvidaEm: Date | null;
  estado: string | null;
}): Exclude<StatusPendencia, 'ABERTAS'> {
  if (p.estado === 'RESPONDIDA_IA') return 'RESPONDIDA_IA';
  if (p.resolvidaEm) return 'ENCERRADA';
  if (p.estado === 'AGUARDANDO_HUMANO') return 'AGUARDANDO_HUMANO';
  return 'PENDENTE';
}

export const NOME_CANAL: Record<string, string> = {
  MARKETPLACE_ML: 'Mercado Livre',
  MARKETPLACE_SHOPEE: 'Shopee',
  MARKETPLACE_SHEIN: 'Shein',
  MARKETPLACE_AMAZON: 'Amazon',
  MARKETPLACE_TIKTOK: 'TikTok',
};

const ROTULO: Record<TipoPendencia, [string, string]> = {
  PERGUNTA: ['pergunta', 'perguntas'],
  MENSAGEM: ['mensagem', 'mensagens'],
  RECLAMACAO: ['reclamação', 'reclamações'],
  DEVOLUCAO: ['devolução', 'devoluções'],
};

const LEMBRETE_MS = 24 * 3600_000;

/** Precisa do lembrete: prazo vence em < 24 h, já avisado, sem lembrete ainda. */
export function precisaLembrete(
  p: { prazo: Date | null; avisadaEm: Date | null; lembreteEm: Date | null },
  agora = new Date(),
): boolean {
  if (!p.prazo || !p.avisadaEm || p.lembreteEm) return false;
  const falta = p.prazo.getTime() - agora.getTime();
  return falta > 0 && falta < LEMBRETE_MS;
}

/**
 * Texto do aviso agrupado da rodada:
 * "4 pendências: 3 na Shopee (2 perguntas, 1 devolução), 1 no Mercado Livre (1 reclamação)".
 * Prazo mais curto entra no fim quando < 24 h.
 */
export function resumoDoAviso(
  itens: Array<{ canal: string; tipo: TipoPendencia; prazo?: Date | null }>,
  agora = new Date(),
): { titulo: string; corpo: string } {
  const porCanal = new Map<string, Map<TipoPendencia, number>>();
  for (const i of itens) {
    const m = porCanal.get(i.canal) ?? new Map<TipoPendencia, number>();
    m.set(i.tipo, (m.get(i.tipo) ?? 0) + 1);
    porCanal.set(i.canal, m);
  }
  const partes = [...porCanal.entries()].map(([canal, m]) => {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const tipos = [...m.entries()].map(([t, n]) => `${n} ${ROTULO[t][n === 1 ? 0 : 1]}`).join(', ');
    const nome = NOME_CANAL[canal] ?? canal;
    const prep = /^(Shopee|Shein|Amazon)$/.test(nome) ? 'na' : 'no';
    return `${total} ${prep} ${nome} (${tipos})`;
  });
  const n = itens.length;
  const prazos = itens
    .map((i) => i.prazo?.getTime())
    .filter((t): t is number => typeof t === 'number' && t > agora.getTime());
  const menor = prazos.length ? Math.min(...prazos) : null;
  const horas = menor !== null ? Math.ceil((menor - agora.getTime()) / 3600_000) : null;
  const urgente = horas !== null && horas <= 24 ? ` · prazo mais curto: ${horas} h` : '';
  return {
    titulo: n === 1 ? '1 pendência nos marketplaces' : `${n} pendências nos marketplaces`,
    corpo: `${partes.join(', ')}${urgente}`,
  };
}
