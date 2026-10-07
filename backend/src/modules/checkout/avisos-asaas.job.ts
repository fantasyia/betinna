import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { CheckoutPublicoService } from './checkout-publico.service';

/**
 * A cada minuto: aviso do Asaas gravado e ainda não processado (o
 * processamento logo após o ACK falhou, ou o processo caiu no meio) é
 * processado de novo. É a rede: pagamento confirmado nunca fica sem virar
 * pedido PAGO por causa de uma falha passageira.
 */
@Injectable()
export class AvisosAsaasJob {
  private readonly logger = new Logger(AvisosAsaasJob.name);

  constructor(
    private readonly checkout: CheckoutPublicoService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('* * * * *', { name: 'checkout-avisos-asaas', timeZone: 'UTC' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('checkout-avisos-asaas', 50))) return;
    try {
      const n = await this.checkout.processarPendentes();
      if (n > 0) this.logger.log(`[checkout] ${n} aviso(s) do Asaas processado(s) na rodada`);
    } catch (err) {
      this.logger.error(`[checkout] falha processando avisos: ${String(err)}`);
    } finally {
      await this.cronLock.release('checkout-avisos-asaas').catch(() => undefined);
    }
  }
}
