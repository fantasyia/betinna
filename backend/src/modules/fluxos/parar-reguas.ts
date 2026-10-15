/**
 * Parar a RÉGUA (Léo + #01, 14/10): cada fluxo marca quando a régua dele para
 * pro lead — o lead respondeu, comprou, mudou de funil ou foi passado pra um
 * atendente. Nada para sem estar marcado. PURO.
 */

export const MOTIVOS_PARAR = ['RESPONDEU', 'COMPROU', 'MUDOU_FUNIL', 'HUMANO'] as const;
export type MotivoParar = (typeof MOTIVOS_PARAR)[number];

/**
 * Qual motivo de parar este evento representa (null = nenhum).
 * `funilOrigem` é o funil da etapa de onde o lead saiu (LEAD_ETAPA_MUDOU).
 */
export function motivoDoEvento(
  triggerTipo: string,
  contexto: Record<string, unknown>,
  funilOrigem?: string | null,
): MotivoParar | null {
  if (triggerTipo === 'LEAD_RESPONDEU') return 'RESPONDEU';
  if (triggerTipo === 'PEDIDO_PAGO') return 'COMPROU';
  if (triggerTipo === 'LEAD_ETAPA_MUDOU') {
    const destino = typeof contexto['funilId'] === 'string' ? contexto['funilId'] : null;
    return funilOrigem && destino && funilOrigem !== destino ? 'MUDOU_FUNIL' : null;
  }
  return null;
}
