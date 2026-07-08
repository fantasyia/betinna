/**
 * Vigência "até o fim do dia" no fuso do tenant (BRT, UTC-3 fixo desde 2019 — sem horário de verão).
 *
 * Datas de validade (`validoAte`, prazo de preço especial, prazo de proposta) são DATAS de calendário
 * (dia inteiro), gravadas à meia-noite UTC quando vêm de um date-picker (`z.coerce.date()` → date-only).
 * Comparar `validoAte >= now` cru faz o item expirar às **21h BRT da VÉSPERA** (00:00 UTC do dia =
 * 21:00 BRT do dia anterior) — o último dia inteiro fica inutilizável.
 *
 * CAÇADA-BUG #25 (preço especial) e #R2 (proposta): considera vigente até 23:59:59.999 BRT do próprio
 * dia impresso. Ponto ÚNICO pra não voltar a divergir entre pricing/propostas/aceite.
 */
export function vigenteAteFimDoDiaBrt(validoAte: Date | null | undefined, now: Date): boolean {
  if (!validoAte) return true;
  // validoAte(00:00 UTC do dia) + 26h59m59s999 = dia+1 02:59:59.999 UTC = dia 23:59:59.999 BRT.
  const FIM_DIA_BRT_MS = 26 * 3600_000 + 59 * 60_000 + 59_000 + 999;
  return now.getTime() <= validoAte.getTime() + FIM_DIA_BRT_MS;
}
