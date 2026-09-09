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
 * ⚠️ TENTEI ALARGAR ISTO EM 09/09 E QUEBREI PRODUÇÃO DUAS VEZES. Fica o registro,
 * porque a ideia parece boa e vai ocorrer a alguém de novo.
 *
 * O problema real: entre COMEÇAR uma execução e ela ESTACIONAR no nó de IA há
 * uma janela de frações de segundo em que ninguém "conduz" por esta definição —
 * e é nela que o texto fixo é enviado. Mensagem que chega nessa janela faz o RT
 * concluir "sumiu e voltou" de quem está falando agora.
 *
 * O que eu fiz: contar também execução PENDENTE/EM_EXECUCAO cujo FLUXO tem um nó
 * de IA. É um proxy, e ele erra de duas formas, as duas medidas em produção:
 *
 *  1. Conta fluxo que JÁ PASSOU do nó de IA. O T1 pula a IA quando o lead já foi
 *     triado, mas o fluxo dele "tem" o nó — então ele contava, e o RT era segurado
 *     por 30 min. Cliente que voltava a escrever recebia silêncio.
 *  2. Conta A PRÓPRIA execução que pergunta. O RT tem um nó de IA; quando a
 *     execução do RT avalia `{{conversa.ia_aguardando}}`, ela se enxerga e
 *     responde "Sim" — sempre, deterministicamente. O RT encerrava, o C1 nunca
 *     era acionado, e não sobrava nem redisparo pra recuperar.
 *
 * Cada remendo produziu um estado pior que o anterior: 3 perguntas repetidas →
 * 30 min de silêncio → silêncio permanente. A lição não é "faltou excluir a
 * própria execução": é que "o fluxo tem um nó de IA" não responde à pergunta
 * "alguém está conduzindo AGORA". Quem quiser fechar a janela precisa de um sinal
 * de POSIÇÃO (a execução ainda vai chegar ao nó?), não de existência.
 *
 * De propósito NÃO é "qualquer execução viva": um DELAY de 3 dias no meio de um
 * fluxo qualquer emudeceria a conversa inteira em silêncio. E os três sinais se
 * soltam sozinhos — timeout do nó, reaper de lock órfão e reaper de execução
 * parada no meio —, então isto nunca trava a conversa para sempre.
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
