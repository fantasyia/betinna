// PERF: `formatTelefone` é o ÚNICO consumidor do `libphonenumber-js` (~120KB de metadata). Vive
// em módulo SEPARADO de `masks.ts` de propósito: masks (formatMoeda etc.) é importado em TODO lugar,
// então deixar o libphonenumber aqui evita que essa metadata gigante viaje no caminho crítico — ela
// só carrega no chunk das telas que de fato formatam telefone (Clientes, Contatos, ClienteContext).
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Formata um telefone pra EXIBIÇÃO internacional (ex: "+55 11 97053-5832").
 * Aceita E.164 (`+55...`) ou número legado nacional (assume BR). Inválido →
 * devolve como veio. Usado onde o dado já está salvo (listas, detalhes).
 */
export function formatTelefone(v: string | null | undefined): string {
  const s = (v ?? '').trim();
  if (!s) return '';
  const tel = parsePhoneNumberFromString(s, 'BR');
  return tel ? tel.formatInternational() : s;
}
