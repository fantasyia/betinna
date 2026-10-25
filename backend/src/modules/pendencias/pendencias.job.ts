import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { PendenciasIaService } from './pendencias-ia.service';
import { PendenciasService } from './pendencias.service';

/**
 * Rotina das pendências de todos os marketplaces conectados (Léo, 24/10), com
 * aviso por push. Desde 25/10 roda a cada 15 min e, na empresa que ligou a IA
 * (pendenciasIa.ativo), responde o cliente — a loja tem a última palavra.
 */
@Injectable()
export class PendenciasJob {
  private readonly logger = new Logger(PendenciasJob.name);

  constructor(
    private readonly pendencias: PendenciasService,
    private readonly ia: PendenciasIaService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('0 */15 * * * *', { name: 'pendencias-marketplace', timeZone: 'America/Sao_Paulo' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('pendencias-marketplace', 1800))) return;
    try {
      for (const empresaId of await this.pendencias.empresasComMarketplace()) {
        try {
          const r = await this.pendencias.rodada(empresaId);
          const ia = await this.ia.processar(empresaId);
          this.logger.log(
            `[pendências] ${empresaId}: ${r.abertas} abertas, ${r.avisadas} avisadas, IA ${ia.respondidas} respondidas / ${ia.humano} pro humano`,
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
