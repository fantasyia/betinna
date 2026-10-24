import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { PendenciasService } from './pendencias.service';

/**
 * Rotina de HORA EM HORA (Léo, 24/10): confere as pendências de todos os
 * marketplaces conectados e avisa por push. Rede de segurança — não depende
 * de webhook. Nada é enviado ao comprador.
 */
@Injectable()
export class PendenciasJob {
  private readonly logger = new Logger(PendenciasJob.name);

  constructor(
    private readonly pendencias: PendenciasService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('0 7 * * * *', { name: 'pendencias-marketplace', timeZone: 'America/Sao_Paulo' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('pendencias-marketplace', 1800))) return;
    try {
      for (const empresaId of await this.pendencias.empresasComMarketplace()) {
        try {
          const r = await this.pendencias.rodada(empresaId);
          this.logger.log(
            `[pendências] ${empresaId}: ${r.abertas} abertas, ${r.avisadas} avisadas`,
          );
        } catch (err) {
          this.logger.warn(`[pendências] ${empresaId} falhou: ${String(err)}`);
        }
      }
    } finally {
      await this.cronLock.release('pendencias-marketplace');
    }
  }
}
