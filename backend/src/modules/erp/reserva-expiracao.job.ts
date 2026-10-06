import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { EstoqueService } from './estoque.service';

/**
 * A cada minuto: reserva de pedido da vitrine que passou dos 20 minutos sem
 * pagamento é liberada e o pedido vira CANCELADO ("reserva expirada").
 *
 * Mesmo sem esta rodada a peça não fica presa: o cálculo do disponível já
 * ignora reserva vencida. O job existe pra o PEDIDO refletir isso.
 */
@Injectable()
export class ReservaExpiracaoJob {
  private readonly logger = new Logger(ReservaExpiracaoJob.name);

  constructor(
    private readonly estoque: EstoqueService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('* * * * *', { name: 'estoque-reserva-expiracao', timeZone: 'UTC' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // TTL menor que o intervalo: rodada travada não bloqueia a seguinte.
    if (!(await this.cronLock.acquire('estoque-reserva-expiracao', 50))) return;
    try {
      const n = await this.estoque.expirarVencidas();
      if (n > 0) this.logger.log(`[estoque] ${n} pedido(s) com reserva expirada cancelado(s)`);
    } catch (err) {
      this.logger.error(`[estoque] falha ao expirar reservas: ${String(err)}`);
    } finally {
      await this.cronLock.release('estoque-reserva-expiracao').catch(() => undefined);
    }
  }
}
