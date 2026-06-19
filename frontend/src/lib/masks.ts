import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Máscaras de input — pure functions.
 *
 * Cada máscara recebe a string raw e retorna a versão formatada.
 * Use junto com `onChange` em inputs:
 *
 *   <Input
 *     value={cnpj}
 *     onChange={(e) => setCnpj(maskCNPJ(e.target.value))}
 *   />
 *
 * Antes de enviar ao backend, sempre use `stripMask` ou os schemas
 * Zod que aceitam formato com pontuação.
 */

/** Remove tudo que não é dígito. Útil pra comparar/persistir. */
export function stripMask(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * Formata um número como moeda BRL — "R$ 1.234,56" (com NBSP, padrão do Intl).
 *
 * Instância ÚNICA de `Intl.NumberFormat` (era a função `fmtBRL` copiada
 * idêntica em ~16 páginas). Saída byte-a-byte igual à das cópias.
 */
const _moedaBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatMoeda(v: number): string {
  return _moedaBRL.format(v);
}

/**
 * Versão compacta pra dashboards/cards — "R$ 1.2M" / "R$ 12.3k". Acima de mil
 * usa sufixo abreviado; abaixo cai no `formatMoeda` completo. Era a função
 * `fmtBRLCompact` copiada idêntica em 7 páginas.
 */
export function formatMoedaCompacta(v: number): string {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return formatMoeda(v);
}

/**
 * Formata um número no padrão pt-BR — "1.234" / "1.234,56" (ponto de milhar,
 * vírgula decimal). Substitui as cópias de `v.toLocaleString('pt-BR')`
 * espalhadas em cards/tabelas. Saída idêntica à do `toLocaleString('pt-BR')`
 * (mesmo default: até 3 casas decimais, separador de milhar ligado).
 *
 * NÃO use pra dinheiro (use `formatMoeda`) nem datas (use `toLocaleString` no
 * `Date` com `dateStyle`/`timeStyle`).
 */
const _numeroBR = new Intl.NumberFormat('pt-BR');
export function formatNumero(v: number): string {
  return _numeroBR.format(v);
}

/**
 * Formata um percentual — "12,3%" no padrão pt-BR. `casas` controla os decimais
 * (default 1). O valor JÁ vem em pontos percentuais (50 = "50,0%"), não em
 * fração. Substitui as cópias de `` `${v.toFixed(n)}%` `` espalhadas.
 *
 * Usa vírgula decimal (`toFixed` dá ponto) pra ficar coerente com `formatMoeda`/
 * `formatNumero` — num CRM que mostra margem/comissão, "12,3%" e não "12.3%".
 */
export function formatPercent(v: number, casas = 1): string {
  return `${v.toFixed(casas).replace('.', ',')}%`;
}

/**
 * CNPJ: 00.000.000/0001-00
 * Aceita parcial — aplica máscara conforme dígitos disponíveis.
 */
export function maskCNPJ(v: string): string {
  const d = stripMask(v).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * CPF: 000.000.000-00
 */
export function maskCPF(v: string): string {
  const d = stripMask(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

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

/**
 * Telefone BR: (00) 0000-0000 ou (00) 00000-0000 (celular). Máscara de INPUT
 * legada — pra cadastro novo use o componente <PhoneInput /> (internacional).
 */
export function maskTelefone(v: string): string {
  const d = stripMask(v).slice(0, 11);
  if (d.length <= 2) return d.length > 0 ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  // 11 dígitos = celular com 9 inicial
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * CEP: 00000-000
 */
export function maskCEP(v: string): string {
  const d = stripMask(v).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/**
 * UF: apenas 2 letras maiúsculas (não é máscara — só normaliza)
 */
export function normalizeUF(v: string): string {
  return v.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2);
}

/**
 * Dinheiro BR: 1.234,56 (sem prefixo R$)
 * Útil pra inputs de valor monetário.
 * Retorna string formatada — converta com `parseDinheiro` antes de enviar.
 */
export function maskDinheiro(v: string): string {
  const d = stripMask(v);
  if (!d) return '';
  const padded = d.padStart(3, '0');
  const integer = padded.slice(0, -2);
  const decimal = padded.slice(-2);
  const integerFormatted = integer
    .replace(/^0+/, '') // remove zeros à esquerda
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.'); // milhares
  return `${integerFormatted || '0'},${decimal}`;
}

/**
 * Inverso do maskDinheiro: "1.234,56" → 1234.56 (number)
 */
export function parseDinheiro(s: string): number {
  if (!s) return 0;
  const clean = s.replace(/\./g, '').replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Valida CNPJ pelos dígitos verificadores. Ignora pontuação.
 * Retorna true se for válido OU se for placeholder/vazio (frontend não bloqueia).
 * O backend tem a fonte da verdade — aqui só evitamos UX ruim.
 */
export function isValidCNPJ(cnpj: string): boolean {
  const d = stripMask(cnpj);
  if (d.length !== 14) return false;
  // 14 dígitos iguais não são válidos
  if (/^(\d)\1{13}$/.test(d)) return false;
  const calc = (slice: number) => {
    let sum = 0;
    let pos = slice - 7;
    for (let i = slice; i >= 1; i--) {
      sum += Number(d[slice - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
