import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { AmazonOrdersService } from './amazon-orders.service';

/**
 * Cron fallback Amazon a cada 10 min:
 *  - Pull de pedidos atualizados nas últimas 24h
 *  - Cada pedido vira/atualiza `MarketplaceOrder` e cria/atualiza
 *    Conversation `order:<id>` na Inbox
 *
 * IMPORTANTE: Amazon NÃO usa webhook HTTP — usa SQS/SNS (não implementado
 * no MVP). Pra Amazon, este cron é o CAMINHO PRINCIPAL, não fallback.
 * Latência máxima = 10 min. Quando volume justificar tempo real, plugar
 * `AmazonNotificationsService` consumindo SQS.
 *
 * SAC Amazon — restrições inerentes da API:
 *  - Não há mensagens INBOUND via API (comprador responde fora do nosso sistema)
 *  - A-to-Z Claims só via Seller Central (sem API pública)
 *  - Customer Service contacts só via Seller Central
 *  - Reviews só leitura (Reports API assíncrono)
 *
 * O que conseguimos cobrir:
 *  - Pedidos (status changes via pull) ✅
 *  - Permitted Actions outbound (sendInvoice, confirmDeliveryDetails,
 *    confirmOrderDetails, unexpectedProblem, getCustomerInformation) ✅
 *  - Conversation por pedido pra anexar tentativas de mensagem do operador ✅
 */
@Injectable()
export class AmazonSyncJob {
  private readonly logger = new Logger(AmazonSyncJob.name);

  constructor(
    private readonly env: EnvService,
    private readonly integracoes: IntegracoesService,
    private readonly orders: AmazonOrdersService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('*/10 * * * *', { name: 'amazon-sync-fallback', timeZone: 'UTC' })
  async fallback(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // AUDITORIA P0-5: TTL 9min — antes da próxima execução
    if (!(await this.cronLock.acquire('amazon-sync-fallback', 9 * 60))) return;
    const ativas = await this.integracoes.listarAtivasPorServico('amazon');
    if (ativas.length === 0) return;
    this.logger.debug(`Sync Amazon fallback: ${ativas.length} empresa(s)`);

    for (const { empresaId } of ativas) {
      try {
        await this.sincronizarEmpresa(empresaId);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Amazon sync fallback empresa=${empresaId}: ${m}`);
      }
    }
  }

  async forcar(empresaId: string, horas = 24): Promise<{ orders: number }> {
    return this.sincronizarEmpresa(empresaId, horas);
  }

  private async sincronizarEmpresa(empresaId: string, horas = 24): Promise<{ orders: number }> {
    let ordersCount = 0;
    try {
      const list = await this.orders.listarRecentes(empresaId, horas);
      for (const o of list) {
        await this.orders.processarOrder(empresaId, o);
        ordersCount++;
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Orders fallback Amazon empresa=${empresaId}: ${m}`);
    }
    return { orders: ordersCount };
  }
}
