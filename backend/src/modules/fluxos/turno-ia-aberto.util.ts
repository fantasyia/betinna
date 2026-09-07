/** O mínimo de Prisma que a pergunta precisa — mantém a util testável e sem DI. */
export interface PrismaComRaw {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export interface AlvoDaConversa {
  conversationId?: string | null;
  leadId?: string | null;
}

/**
 * **Tem turno de IA ABERTO nesta conversa?** — a pergunta que faltava no motor.
 *
 * Sem ela, os fluxos usavam a ETAPA do lead como proxy de "tem alguém
 * conduzindo", e o proxy erra nos dois sentidos. Os dois casos foram medidos em
 * produção em 07/09:
 *
 * - **RB.10** — a etapa diz "parado", mas há turno aberto → a reabordagem
 *   ATROPELA o consultivo no meio de uma pergunta.
 * - **RT** — a etapa diz "em andamento" (`Calculadora enviada`), mas não há
 *   execução nenhuma: essa etapa é TERMINAL do consultivo, ele chega ali porque
 *   acabou. Quem abriu o link e voltou com dúvida ficou sem resposta, no momento
 *   mais quente do funil.
 *
 * Uma definição só, usada pelo guard do bus (disparo proativo) e pelo
 * `{{conversa.ia_aguardando}}` das condições — duas expressões diferentes pra
 * mesma pergunta dariam duas respostas, que é como o proxy da etapa nasceu.
 *
 * **Aberto** = execução viva parada NO nó "Conversar com IA" (`aguardandoNoId`
 * aponta pra ele: está esperando a resposta do cliente) **ou** com o lock do
 * turno tomado (`processandoTurno`: a IA está gerando a resposta agora).
 *
 * De propósito NÃO é "qualquer execução viva": um DELAY de 3 dias no meio de um
 * fluxo qualquer emudeceria a conversa inteira em silêncio. E os dois sinais se
 * soltam sozinhos — timeout do nó e reaper de lock órfão —, então isto nunca
 * trava a conversa para sempre.
 *
 * ⚠️ Responde "ALGUÉM está conduzindo", inclusive a própria execução que
 * pergunta, se for ela a dona do turno. Serve pra um fluxo decidir se atropela
 * OUTRO; não serve como "eu já falei?".
 */
export async function turnoDeIaAberto(
  prisma: PrismaComRaw,
  empresaId: string,
  alvo: AlvoDaConversa,
): Promise<boolean> {
  const conversationId = typeof alvo.conversationId === 'string' ? alvo.conversationId : '';
  const leadId = typeof alvo.leadId === 'string' ? alvo.leadId : '';
  if (!conversationId && !leadId) return false;

  // RAW porque o filtro precisa do nó em que a execução parou e não existe
  // relação Prisma FluxoExecucao→FluxoNo por `aguardandoNoId`. String vazia no
  // lugar de NULL evita "could not determine data type of parameter", e nenhum
  // contexto tem chave igual a ''.
  const abertos = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT e.id
    FROM "FluxoExecucao" e
    LEFT JOIN "FluxoNo" n ON n.id = e."aguardandoNoId"
    WHERE e."empresaId" = ${empresaId}
      AND e.status IN ('PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO')
      AND (
        (e.contexto #>> '{conversationId}') = ${conversationId}
        OR (e.contexto #>> '{leadId}') = ${leadId}
      )
      AND (n."acaoTipo" = 'CONVERSAR_IA' OR e."processandoTurno" = true)
    LIMIT 1`;
  return abertos.length > 0;
}
