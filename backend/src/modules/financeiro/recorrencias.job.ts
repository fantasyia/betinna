import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { FinanceiroService } from './financeiro.service';

/**
 * Todo dia de manhã: garante o lançamento deste mês e do próximo pra cada
 * despesa/receita recorrente (aluguel, contador…). Idempotente — rodar duas
 * vezes não duplica (único por recorrência + vencimento).
 */
@Injectable()
export class RecorrenciasJob {
  private readonly logger = new Logger(RecorrenciasJob.name);

  constructor(
    private readonly fin: FinanceiroService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('0 9 * * *', { name: 'financeiro-recorrencias', timeZone: 'UTC' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('financeiro-recorrencias', 300))) return;
    try {
      await this.fin.gerarRecorrentes();
    } catch (err) {
      this.logger.error(`[financeiro] recorrentes falharam: ${String(err)}`);
    }
  }
}
