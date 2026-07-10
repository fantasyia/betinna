/**
 * Posicionamento fracionário estilo Trello (Parte 1 da spec).
 *
 * Itens (listas/cards) carregam `posicao Float`. Inserir entre A e B =
 * média (posA+posB)/2. Quando a diferença entre vizinhos fica menor que
 * POSICAO_EPSILON, o chamador rebalanceia a coleção inteira (1024, 2048…).
 */

/** Espaçamento padrão entre itens ao criar/rebalancear. */
export const POSICAO_GAP = 1024;

/** Diferença mínima entre vizinhos antes de exigir rebalanceamento. */
export const POSICAO_EPSILON = 0.0001;

/** Posição pra inserir no fim: última + GAP (ou GAP se coleção vazia). */
export function posicaoNoFim(ultimaPosicao: number | null | undefined): number {
  return (ultimaPosicao ?? 0) + POSICAO_GAP;
}

/** Posição entre dois vizinhos (qualquer um pode ser ausente). */
export function posicaoEntre(antes: number | null, depois: number | null): number {
  if (antes === null && depois === null) return POSICAO_GAP;
  if (antes === null) return (depois as number) / 2;
  if (depois === null) return antes + POSICAO_GAP;
  return (antes + depois) / 2;
}

/**
 * Detecta se alguma dupla de vizinhos (ordenados por posicao) ficou com
 * gap menor que o epsilon — hora de rebalancear.
 */
export function precisaRebalancear(posicoesOrdenadas: number[]): boolean {
  for (let i = 1; i < posicoesOrdenadas.length; i++) {
    if (posicoesOrdenadas[i] - posicoesOrdenadas[i - 1] < POSICAO_EPSILON) return true;
  }
  return false;
}

/** Novas posições 1024, 2048, 3072… na ordem recebida. */
export function rebalancear<T extends { id: string }>(
  itensOrdenados: T[],
): { id: string; posicao: number }[] {
  return itensOrdenados.map((item, i) => ({ id: item.id, posicao: (i + 1) * POSICAO_GAP }));
}
