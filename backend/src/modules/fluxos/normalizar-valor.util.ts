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
