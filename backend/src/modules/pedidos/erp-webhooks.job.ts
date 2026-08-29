import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { TinyWebhookProcessorService } from '@integrations/tiny/tiny-webhook-processor.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { PedidoErpSyncService } from './pedido-erp-sync.service';

/**
 * Drena a fila de webhooks do Tiny — de minuto em minuto.
 *
 * Não vira a "segunda automação diária" que o Léo pediu pra evitar: aquela
 * regra é sobre VARREDURA (puxar tudo). Isto é reação a evento — o ERP avisa
 * que algo mudou e o app aplica em ~1 minuto, em vez de esperar a madrugada.
 * A rodada diária continua sendo a rede de baixo: pega o que o webhook perdeu.
 *
 * Mora no módulo de PEDIDOS porque é aqui que vive a regra de aplicar pedido —
 * o processador é transporte e recebe o aplicador por parâmetro, o que mantém
 * a dependência numa direção só (pedidos → tiny).
 */
@Injectable()
export class ErpWebhooksJob {
  private readonly logger = new Logger(ErpWebhooksJob.name);

  constructor(
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
    private readonly processor: TinyWebhookProcessorService,
    private readonly pedidos: PedidoErpSyncService,
  ) {}

  @Cron('* * * * *', { name: 'erp-webhooks', timeZone: 'UTC' })
  async drenar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // TTL 50s: menor que o intervalo, pra uma rodada travada não bloquear a
    // seguinte pra sempre. Duas réplicas puxando a mesma fila duplicariam o
    // trabalho (não o dado — a aplicação é idempotente), mas queimariam o rate
    // limit do Tiny à toa.
    if (!(await this.cronLock.acquire('erp-webhooks', 50))) return;

    try {
      const r = await this.processor.processarPendentes(this.pedidos);
      // Silêncio quando não há evento: um log por minuto sem novidade esconde
      // justamente o log que importa.
      if (r.lidos > 0) {
        this.logger.log(
          `[tiny] webhooks processados: ${r.aplicados}/${r.lidos} aplicados` +
            (r.repetidos ? `, ${r.repetidos} repetidos` : '') +
            (r.erros ? `, ${r.erros} com erro` : ''),
        );
      }
    } catch (err) {
      this.logger.error(
        `[tiny] falha ao drenar webhooks: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
