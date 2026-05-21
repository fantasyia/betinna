/**
 * Helpers de formatação pt-BR.
 *
 * Foram criados no fix G3 (2026-05-21) pra padronizar exibição de
 * data/hora em todo o app. Aceitam string ISO (`'2026-05-21'`),
 * Date ou epoch (number). Devolvem string vazia se receber `null`,
 * `undefined` ou data inválida (em vez de "Invalid Date").
 *
 * **Importante**: o input `<input type="date">` continua dependendo do
 * locale do SO/navegador (Chrome ignora `lang` do input em muitas versões).
 * Estes helpers cobrem só DISPLAY read-only.
 */

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
});

type DateInput = string | number | Date | null | undefined;

/** Normaliza a entrada em Date válido ou null. */
function toDate(input: DateInput): Date | null {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Data como dd/mm/aaaa. Aceita ISO, Date, epoch ou null. */
export function formatDateBR(input: DateInput): string {
  const d = toDate(input);
  return d ? dateFormatter.format(d) : '';
}

/** Data + hora como dd/mm/aaaa hh:mm. */
export function formatDateTimeBR(input: DateInput): string {
  const d = toDate(input);
  return d ? dateTimeFormatter.format(d) : '';
}

/** Só a hora hh:mm. */
export function formatTimeBR(input: DateInput): string {
  const d = toDate(input);
  return d ? timeFormatter.format(d) : '';
}

/**
 * Converte Date / ISO em string compatível com `<input type="date">`
 * (formato yyyy-mm-dd — o input nativo sempre usa esse, independente
 * do que o usuário VÊ).
 */
export function toDateInputValue(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
