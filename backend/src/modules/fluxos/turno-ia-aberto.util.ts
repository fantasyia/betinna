/** O mínimo de Prisma que a pergunta precisa — mantém a util testável e sem DI. */
export interface PrismaComRaw {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export interface AlvoDaConversa {
  conversationId?: string | null;
  leadId?: string | null;
  /**
   * A execução que está PERGUNTANDO, pra não se enxergar.
   *
   * Foi a segunda regressão de 09/09: o RT tem um nó de IA, e quando a execução
   * dele avaliava `{{conversa.ia_aguardando}}` ela se contava e respondia "Sim"
   * — sempre, deterministicamente. O RT encerrava e o C1 nunca era acionado.
   *
   * Sem isto o `_iaAFrente` reproduz o mesmo defeito, porque a execução que
   * pergunta está viva e, quase sempre, ainda alcança o próprio nó de IA.
   */
  execucaoId?: string | null;
}

/**
 * Janela em que "execução recém-começada" ainda é uma afirmação honesta.
 *
 * O buraco que o `_iaAFrente` fecha dura FRAÇÕES DE SEGUNDO — entre começar uma
 * execução e ela estacionar no nó de IA. 30s é folga generosa pra um passo
 * lento (envio com pacing, consulta ao ERP) e está muito longe de um DELAY.
 *
 * O limite não é conforto, é o que impede o desastre do proxy antigo: execução
 * parada num DELAY de 3 dias continua `EM_EXECUCAO` (nada a devolve pra
 * PENDENTE), então sem janela ela emudeceria a conversa por três dias.
 */
const JANELA_A_FRENTE_MS = 30_000;

/** Teto de profundidade da busca no grafo — corta ciclo e grafo patológico. */
const PROFUNDIDADE_MAX = 40;

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
/**
 * **A execução ainda VAI CHEGAR ao nó de IA?** — o sinal de POSIÇÃO que faltava.
 *
 * Fecha a janela que o `turnoDeIaAberto` não alcança: entre COMEÇAR uma execução
 * e ela ESTACIONAR no nó de IA há frações de segundo em que ninguém "conduz" por
 * aquela definição — e é nela que um fluxo proativo dispara texto fixo por cima
 * de quem está falando agora.
 *
 * ⚠️ Isto NÃO é o proxy que quebrou produção duas vezes em 09/09. A diferença é
 * a pergunta, e ela é toda a diferença:
 *
 *   proxy velho  →  "o FLUXO desta execução TEM um nó de IA?"   (existência)
 *   este         →  "DAQUI, a execução ainda ALCANÇA um nó de IA?"  (posição)
 *
 * As duas regressões medidas caem sozinhas com a pergunta certa:
 *
 *  1. **T1 que já passou da IA** — o T1 pula o nó quando o lead já foi triado.
 *     O fluxo "tem" o nó, então o proxy contava e o RT era segurado 30 min. Aqui
 *     a posição é depois da condição, o nó de IA não é mais alcançável, e a
 *     resposta é "não". O caminho que a execução JÁ escolheu importa.
 *  2. **RT se enxergando** — resolvido por `execucaoId`, não por sorte: a
 *     execução que pergunta é excluída da busca.
 *
 * Três limites, e nenhum é decorativo:
 *
 *  - **só `EM_EXECUCAO`**: quem está `AGUARDANDO` já é coberto pela definição
 *    principal, e contar duas vezes não muda a resposta mas confunde o debug;
 *  - **janela de 30s** (`JANELA_A_FRENTE_MS`): execução parada num DELAY de 3
 *    dias continua `EM_EXECUCAO`. Sem a janela, ela emudeceria a conversa por
 *    três dias — que é pior que o problema original;
 *  - **teto de profundidade**: grafo com ciclo (RT→C1→RT existe) faria a CTE
 *    recursiva rodar pra sempre.
 *
 * A posição é o `noId` do ÚLTIMO log da execução; execução sem log nenhum
 * (nasceu agora) parte do TRIGGER, que é a verdade — ela ainda não escolheu
 * caminho nenhum.
 *
 * A alcançabilidade é OTIMISTA de propósito: uma CONDICAO à frente pode desviar
 * da IA, e a busca conta os dois ramos. Errar pra "tem alguém conduzindo" custa
 * um proativo adiado por até 30s; errar pro contrário custa atropelar um cliente
 * no meio de uma frase. Os dois erros não têm o mesmo preço.
 */
export async function iaAFrente(
  prisma: PrismaComRaw,
  empresaId: string,
  alvo: AlvoDaConversa,
): Promise<boolean> {
  const conversationId = typeof alvo.conversationId === 'string' ? alvo.conversationId : '';
  const leadId = typeof alvo.leadId === 'string' ? alvo.leadId : '';
  if (!conversationId && !leadId) return false;
  // String vazia no lugar de NULL: nenhuma execução tem id igual a ''.
  const eu = typeof alvo.execucaoId === 'string' ? alvo.execucaoId : '';
  const desde = new Date(Date.now() - JANELA_A_FRENTE_MS);

  const achados = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE candidata AS (
      SELECT
        e.id,
        e."fluxoId",
        COALESCE(
          (SELECT l."noId" FROM "FluxoExecucaoLog" l
            WHERE l."execucaoId" = e.id AND l."noId" IS NOT NULL
            ORDER BY l."iniciadoEm" DESC LIMIT 1),
          (SELECT n.id FROM "FluxoNo" n
            WHERE n."fluxoId" = e."fluxoId" AND n.tipo = 'TRIGGER' LIMIT 1)
        ) AS pos
      FROM "FluxoExecucao" e
      WHERE e."empresaId" = ${empresaId}
        AND e.status = 'EM_EXECUCAO'
        AND e.id <> ${eu}
        AND e."iniciouEm" >= ${desde}
        AND (
          (e.contexto #>> '{conversationId}') = ${conversationId}
          OR (e.contexto #>> '{leadId}') = ${leadId}
        )
    ),
    alcance AS (
      SELECT c.id AS "execId", c."fluxoId", c.pos AS "noId", 0 AS nivel
      FROM candidata c
      WHERE c.pos IS NOT NULL
      UNION ALL
      SELECT a."execId", a."fluxoId", ed."targetNoId", a.nivel + 1
      FROM alcance a
      JOIN "FluxoEdge" ed
        ON ed."sourceNoId" = a."noId" AND ed."fluxoId" = a."fluxoId"
      WHERE a.nivel < ${PROFUNDIDADE_MAX}
    )
    SELECT DISTINCT a."execId" AS id
    FROM alcance a
    JOIN "FluxoNo" n ON n.id = a."noId"
    WHERE n."acaoTipo" = 'CONVERSAR_IA'
    LIMIT 1`;
  return achados.length > 0;
}

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
