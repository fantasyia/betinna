/**
 * Sucessores gravados no `FluxoStepClaim.proximos` — com o QUANDO.
 *
 * O claim guardava só o id do próximo nó. Quando o enqueue original se perdia
 * (blip do Redis, SIGTERM de deploy) e o skip idempotente ou o reaper
 * reenfileiravam, o sucessor de um DELAY "2 dias" saía com delay ZERO — a régua
 * inteira disparava agora (auditoria 13/09/2026, achado D-1).
 *
 * Formato: `<noId>` (sem alvo) ou `<noId>@<epochMs>` (alvo do DELAY). É string
 * porque a coluna é `String[]` — sem migration, e linhas antigas (só o id)
 * continuam válidas.
 */
export interface ProximoClaim {
  noId: string;
  /** Instante em que o sucessor DEVE rodar; null = imediato. */
  alvoEm: number | null;
}

export function codificarProximo(noId: string, alvoEm: number | null): string {
  return alvoEm && Number.isFinite(alvoEm) ? `${noId}@${Math.round(alvoEm)}` : noId;
}

export function lerProximo(bruto: string): ProximoClaim {
  const i = bruto.lastIndexOf('@');
  if (i <= 0) return { noId: bruto, alvoEm: null };
  const alvo = Number(bruto.slice(i + 1));
  if (!Number.isFinite(alvo) || alvo <= 0) return { noId: bruto, alvoEm: null };
  return { noId: bruto.slice(0, i), alvoEm: alvo };
}

/** Quanto ainda falta pro alvo — nunca negativo (alvo no passado = agora). */
export function delayRestanteMs(alvoEm: number | null, agora = Date.now()): number {
  if (!alvoEm) return 0;
  return Math.max(0, alvoEm - agora);
}
