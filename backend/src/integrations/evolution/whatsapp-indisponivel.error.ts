import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientError } from '@shared/http/http-client.types';

/**
 * Envio falhou porque a PORTA estava fechada — não porque a mensagem era ruim.
 *
 * A distinção existe porque as duas falhas pedem reações opostas:
 *  - indisponibilidade (instância caída, Evolution reiniciando, rede piscando)
 *    é "ainda não": esperar resolve;
 *  - erro permanente (número inexistente, bloqueio, mídia recusada) é "nunca":
 *    esperar só atrasa o aviso a quem precisava saber.
 *
 * É a MESMA família de `ForaDaJanelaEnvioError`, que já é relançado pro executor
 * reagendar em vez de mandar a execução pro ramo de erro. A diferença é só o
 * tempo de volta: a janela volta na hora marcada, a instância volta quando
 * volta — em nenhum dos dois o certo é desistir na primeira tentativa.
 *
 * Estende BusinessRuleException de propósito: quem chama o envio direto por
 * controller (fora de fluxo) continua vendo o mesmo 400 de antes. Só quem faz
 * `instanceof` muda de comportamento.
 */
export class WhatsappIndisponivelError extends BusinessRuleException {
  constructor(public readonly detalhe: string) {
    super(`WhatsApp indisponível no momento: ${detalhe}`, ErrorCode.INTEGRATION_ERROR);
    this.name = 'WhatsappIndisponivelError';
  }
}

/**
 * O número NÃO EXISTE no WhatsApp — e nenhuma espera conserta isso.
 *
 * É o terceiro caso, e ele não é nem "porta fechada" nem "erro qualquer":
 *  - indisponível → espera resolve (reagenda);
 *  - destinatário inválido → esperar é repetir pra sempre;
 *  - o resto → falha do nó, com retry.
 *
 * Medido em produção 09/09 (exec cmttkj84q005as1brr627ji8w): pedido de R$ 4.350
 * fechado no site com um telefone que não existe no WhatsApp. O Evolution
 * respondeu na hora e certo — `{"jid":"...","exists":false}` — mas pro motor
 * isso era falha genérica: 3 tentativas, execução FALHOU, fim. O nó SEGUINTE
 * era `Pausar IA — pedido é assunto de gente`, e ele nunca rodou.
 *
 * O estado que sobrou é o pior possível: as tags diziam que a pessoa comprou, a
 * confirmação não chegou, o bot ficou LIGADO na conversa de quem acabou de
 * gastar R$ 4.350, e ninguém foi avisado.
 *
 * O princípio: um canal que não dá pra usar não pode cancelar as decisões que
 * NÃO dependem daquele canal. Pausar o bot e avisar um humano são exatamente
 * isso — e é por isso que este erro faz o motor SEGUIR, não desistir.
 */
export class DestinatarioInvalidoError extends BusinessRuleException {
  constructor(public readonly detalhe: string) {
    super(`Destinatário inválido no WhatsApp: ${detalhe}`, ErrorCode.INTEGRATION_ERROR);
    this.name = 'DestinatarioInvalidoError';
  }
}

/**
 * O Evolution diz "esse número não existe" de duas formas: o corpo estruturado
 * com `exists:false` (o caso real de 09/09) e a frase solta em inglês, que
 * varia com a versão.
 *
 * Deliberadamente ESTREITO. Errar pra cá é pior que errar pro outro lado: dar
 * um número por inexistente faz o motor PULAR o envio e seguir, e o cliente
 * nunca recebe a mensagem — sem retry e sem segunda chance. Na dúvida, cai no
 * caminho de falha normal, que ao menos tenta de novo.
 */
export function ehDestinatarioInvalido(err: unknown): boolean {
  if (err instanceof DestinatarioInvalidoError) return true;

  const corpo =
    err instanceof HttpClientError && err.body ? JSON.stringify(err.body).toLowerCase() : '';
  // `"exists":false` é a resposta estruturada — a que não depende de tradução
  // nem de versão do Evolution.
  if (/"exists"\s*:\s*false/.test(corpo)) return true;

  const msg = (
    (err instanceof Error ? err.message : String(err ?? '')) +
    ' ' +
    corpo
  ).toLowerCase();
  return [
    'number does not exist',
    'number not exists',
    'does not exist on whatsapp',
    'not a valid whatsapp',
    'invalid jid',
    'invalid number',
  ].some((m) => msg.includes(m));
}

/**
 * Marcas de indisponibilidade no corpo/mensagem do erro.
 *
 * Lista explícita, e não "tudo que não reconheço é transitório": errar pro lado
 * de reagendar significa segurar por horas uma mensagem que nunca ia sair, e o
 * lead fica esperando um contato que não vem. Na dúvida, trata como permanente
 * — o ramo de erro cria tarefa e alguém olha.
 */
const MARCAS_INDISPONIVEL = [
  'connection closed', // Evolution com a instância derrubada (o caso de 21/08)
  'connection lost',
  'not connected',
  'instance not connected',
  'socket hang up',
  'econnrefused',
  'econnreset',
  'etimedout',
  'esockettimedout',
  'enotfound',
  'eai_again',
  'network error',
  'timeout',
  'aborted',
];

/**
 * O erro é de PORTA FECHADA (dá pra tentar de novo) ou de conteúdo/destino
 * (não adianta)?
 *
 * HTTP 5xx entra: é o servidor dizendo que ele falhou, não que o pedido estava
 * errado. 4xx fica de fora — inclusive 401/403 (credencial errada não conserta
 * sozinha) e 404 (instância que não existe é configuração, não queda).
 * A exceção é o 400 do Evolution, que ele usa pra TUDO: aí vale o corpo, e é
 * onde mora o "Error: Connection Closed".
 */
export function ehIndisponibilidade(err: unknown): boolean {
  if (err instanceof WhatsappIndisponivelError) return true;

  if (err instanceof HttpClientError) {
    if (err.status >= 500) return true;
    if (err.status === 408 || err.status === 429) return true;
    const corpo = err.body ? JSON.stringify(err.body).toLowerCase() : '';
    return MARCAS_INDISPONIVEL.some((m) => corpo.includes(m));
  }

  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return MARCAS_INDISPONIVEL.some((m) => msg.includes(m));
}
