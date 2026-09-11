/**
 * Normalização ÚNICA de rótulo/valor/etiqueta: trim + minúsculas + SEM acento
 * (NFKD) + espaços internos colapsados.
 *
 * Vive num util próprio porque DOIS caminhos dependem dela e não podem divergir:
 *  - `fluxo-executor.service` (roteamento de CONDICAO por rótulo de saída);
 *  - `fluxo-event-bus` (match de etiqueta no gatilho LEAD_RECEBEU_TAG).
 * O editor usa a mesma no frontend (`saidas.ts`).
 *
 * Note que o `:` das etiquetas-DIMENSÃO (`publico:comercio`, `setor:cadeia-do-frio`)
 * ATRAVESSA intacto — nada aqui separa, corta ou escapa dois-pontos.
 */
export function normalizarValor(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

/**
 * Valores que significam "nao informado" — AUSENCIA, nao resposta.
 *
 * Mora aqui, e nao no servico, porque DOIS lados precisam da mesma lista e
 * divergir entre eles e o tipo de bug que ninguem ve: a gravacao trata
 * "nao sei" como ausencia (pra nao apagar valor concreto) e a rede
 * deterministica precisa da MESMA leitura pra saber que ali cabe resgate.
 * Duas copias da lista dariam duas definicoes de ausencia.
 */
export const NAO_SEI = new Set([
  'nao sei',
  'nao informado',
  'nao confirmado',
  'nao informou',
  'desconhecido',
  'indefinido',
  'n/a',
  'na',
  '-',
  '?',
]);

/** `true` quando o valor e uma forma de "nao informado". */
export const ehNaoSei = (v: unknown): boolean => NAO_SEI.has(normalizarValor(String(v ?? '')));
