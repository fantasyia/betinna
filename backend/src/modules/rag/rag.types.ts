/** Fila de indexação semântica (gera embedding de produto / chunk de conhecimento). */
export const INDEXACAO_QUEUE = 'rag-indexacao';

export type IndexacaoJobData =
  | { tipo: 'produto'; id: string; empresaId: string }
  | { tipo: 'chunk'; id: string; empresaId: string };
