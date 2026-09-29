/**
 * Ações que um fluxo PESSOAL (de um usuário, não da empresa) não pode ter.
 *
 * Fonte única pra dois pontos que precisam concordar:
 *  - a VALIDAÇÃO do grafo (`FluxosService.validarGrafoPessoal`), que recusa na
 *    criação/edição/import;
 *  - o EXECUTOR, que recusa em tempo de execução — cobre fluxo gravado antes da
 *    regra existir, que a validação nunca mais vai ver.
 *
 * - ATRIBUIR_REP / TRANSFERIR_ATENDIMENTO / LIBERAR_LOTE agem fora da carteira do dono.
 * - WEBHOOK_EXTERNO manda dado de lead pra uma URL qualquer: numa mão de REP vira
 *   exportação silenciosa da carteira. Decisão do Léo (29/09/2026): só DIRECTOR,
 *   ou seja, só em fluxo da EMPRESA (que já é ADMIN/DIRECTOR-only).
 */
export const ACOES_PROIBIDAS_PESSOAL: ReadonlySet<string> = new Set([
  'ATRIBUIR_REP',
  'TRANSFERIR_ATENDIMENTO',
  'LIBERAR_LOTE',
  'WEBHOOK_EXTERNO',
]);
