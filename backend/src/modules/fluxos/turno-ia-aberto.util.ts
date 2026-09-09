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
 * **Aberto TAMBÉM** = execução viva CAMINHANDO num fluxo que tem nó de IA — a
 * janela entre começar e estacionar no nó. Ela dura frações de segundo e era
 * invisível aqui, o que produzia o pior atendimento que este sistema já deu:
 *
 *   20:00:18  cliente → "opa, e o disjuntor geral aqui e de 63A"
 *   20:00:21  cliente → "a tensao e 220V"
 *   20:00:25  BOT     → "Consegue olhar no quadro de luz…? Qual aparece?"
 *   20:00:34  BOT     → "Consegue olhar no quadro de luz…? Qual aparece?"
 *   20:00:39  BOT     → "Consegue olhar no quadro de luz…? Qual aparece?"
 *
 * A mesma pergunta três vezes, palavra por palavra, pra quem já tinha respondido
 * na primeira linha. Mandar três mensagens seguidas é o que qualquer pessoa faz
 * no WhatsApp — então o defeito estava no caso NORMAL, não no raro.
 *
 * O mecanismo: a 2ª mensagem chega enquanto o consultivo ainda caminha rumo ao
 * nó de IA. Sem `aguardandoNoId` e sem `processandoTurno`, esta função dizia
 * "ninguém conduzindo", o RT concluia "sumiu e voltou" de quem estava falando
 * NAQUELE instante, e o consultivo recomeçava do topo — reenviando o texto fixo
 * antes de o supersede alcançar a execução anterior.
 *
 * O recorte é estreito de propósito: **só fluxo que TEM nó de IA**. Um fluxo de
 * aviso (P1, P2) caminhando não cala conversa nenhuma.
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
      AND (
        n."acaoTipo" = 'CONVERSAR_IA'
        OR e."processandoTurno" = true
        -- A JANELA: execução ainda caminhando rumo ao nó de IA. Só vale pra
        -- fluxo que TEM esse nó — fluxo de aviso caminhando não conduz conversa.
        OR (
          e.status IN ('PENDENTE', 'EM_EXECUCAO')
          AND EXISTS (
            SELECT 1 FROM "FluxoNo" fn
            WHERE fn."fluxoId" = e."fluxoId" AND fn."acaoTipo" = 'CONVERSAR_IA'
          )
        )
      )
    LIMIT 1`;
  return abertos.length > 0;
}
