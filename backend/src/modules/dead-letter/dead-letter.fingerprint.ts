/**
 * Chave de agrupamento dos erros que morrem na dead-letter.
 *
 * ⚠️ POR QUE ISTO EXISTE: o Sentry agrupa por PILHA quando existe uma, e a pilha
 * de tudo que passa pelo `DeadLetterProcessor` é a mesma — `process()` chamado
 * pelo worker do BullMQ. Sem fingerprint, um bug de código e uma guarda que
 * barrou um envio de propósito caem na MESMA issue, com o título do evento mais
 * recente. Medido em 10/09/2026 (`BETINNA-API-3`): o defeito do `PAUSAR_IA` das
 * 03:01 ficou escondido atrás de um bloqueio de envio das 08:06, e resolver a
 * issue pelo primeiro marcou o segundo como resolvido junto.
 *
 * A chave precisa ser ESTÁVEL entre ocorrências do mesmo defeito — senão cada
 * job vira uma issue nova e o painel fica pior do que estava. Por isso a
 * normalização apaga tudo que muda de execução pra execução (nome do nó, ids,
 * números, datas) e mantém só a forma da frase.
 */

/** UUID canônico, com hífens. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Token longo que mistura letra e dígito: cuid (`cmtv7wi9i0020o7bryxqj7vub`),
 * uuid sem hífen, id de job. Os dois lookaheads exigem pelo menos um de cada,
 * pra não comer palavra comum.
 */
const ID_ALFANUMERICO = /\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{12,}\b/gi;

/**
 * Números, datas, horas, valores — tudo que conta ocorrência em vez de tipo.
 *
 * Sem `\b` no fim de propósito: número colado numa unidade (`30000ms`, `5s`) não
 * tem fronteira de palavra ali, e exigir uma deixava passar justamente a métrica
 * que muda a cada execução.
 */
const NUMEROS = /\b\d[\d.,:/-]*/g;

/** Texto entre aspas: nome do nó, título do fluxo, nome do lead. */
const ENTRE_ASPAS = /(["'`])(?:(?!\1).)*\1/g;

const TAMANHO_MAXIMO = 120;

/**
 * Reduz a mensagem de erro à sua forma — o que sobra identifica o DEFEITO, não
 * a ocorrência.
 *
 * ```
 * Nó "Religar IA — ele pode perguntar quando chega" falhou: contexto.leadId ausente para PAUSAR_IA
 * → Nó "" falhou: contexto.leadId ausente para PAUSAR_IA
 * ```
 */
export function formaDoErro(mensagem: string): string {
  return mensagem
    .replace(ENTRE_ASPAS, '""')
    .replace(UUID, '#')
    .replace(ID_ALFANUMERICO, '#')
    .replace(NUMEROS, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TAMANHO_MAXIMO);
}

/**
 * Fingerprint do evento no Sentry: origem do job + forma do erro.
 *
 * A fila e o nome do job entram porque o mesmo texto de erro vindo de filas
 * diferentes é, na prática, outro problema — e porque eles dão ao grupo um
 * rótulo legível em vez de uma frase truncada.
 */
export function fingerprintDeadLetter(params: {
  originalQueue: string;
  originalJobName: string;
  error: string;
}): string[] {
  return ['dead-letter', params.originalQueue, params.originalJobName, formaDoErro(params.error)];
}
