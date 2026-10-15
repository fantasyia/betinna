import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { CarrinhoRecuperadorService } from './carrinho-recuperador.service';

/**
 * A cada minuto (worker): pedido da vitrine sem pagamento e carrinho do link
 * do WhatsApp parados há 20 min viram aviso pro motor de fluxos (Léo, 14/10).
 */
@Injectable()
export class CarrinhoRecuperadorJob {
  private readonly logger = new Logger(CarrinhoRecuperadorJob.name);

  constructor(
    private readonly recuperador: CarrinhoRecuperadorService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('* * * * *', { name: 'vitrine-recuperador-carrinho', timeZone: 'UTC' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('vitrine-recuperador-carrinho', 50))) return;
    try {
      const n = await this.recuperador.verificar();
      if (n > 0) this.logger.log(`[recuperador] ${n} aviso(s) de carrinho/pedido parado`);
    } catch (err) {
      this.logger.error(`[recuperador] falha na rodada: ${String(err)}`);
    } finally {
      await this.cronLock.release('vitrine-recuperador-carrinho').catch(() => undefined);
    }
  }
}
