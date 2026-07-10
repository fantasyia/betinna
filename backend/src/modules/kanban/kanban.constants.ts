/**
 * Constantes compartilhadas do módulo Kanban.
 */

/** Campos públicos de usuário embutidos em respostas (nunca vazar tokens/teto). */
export const USUARIO_RESUMO = {
  select: { id: true, nome: true, email: true, avatar: true },
} as const;

/** Quantas atividades retornar no card completo (modal). */
export const CARD_ATIVIDADES_LIMIT = 30;
