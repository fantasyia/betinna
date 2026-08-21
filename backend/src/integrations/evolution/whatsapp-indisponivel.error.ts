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
