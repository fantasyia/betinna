/**
 * Helpers de data para filtros/períodos vindos de `<input type="date">` (formato 'YYYY-MM-DD').
 *
 * ⚠️ CAÇADA-BUG #14: `new Date('YYYY-MM-DD')` é interpretado como MEIA-NOITE UTC. No Brasil (UTC-3)
 * isso vira 21:00 da véspera → o início do período cai no dia anterior e o fim não cobre o dia certo,
 * escondendo registros "de hoje". Anexar um horário SEM timezone (`T00:00:00`) força o parse no fuso
 * LOCAL do usuário; `toISOString()` então devolve o instante UTC correto pra mandar pra API.
 */

/** 'YYYY-MM-DD' → ISO do INÍCIO do dia (00:00:00) no fuso LOCAL. */
export function inicioDoDiaLocalISO(data: string): string {
  return new Date(`${data}T00:00:00`).toISOString();
}

/** 'YYYY-MM-DD' → ISO do FIM do dia (23:59:59.999) no fuso LOCAL. */
export function fimDoDiaLocalISO(data: string): string {
  return new Date(`${data}T23:59:59.999`).toISOString();
}
