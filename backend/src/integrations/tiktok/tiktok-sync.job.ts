import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { TikTokOrdersService } from './tiktok-orders.service';
import { TikTokReturnsService } from './tiktok-returns.service';

/**
 * Cron fallback TikTok Shop (a cada 10 min):
 *  - Returns abertos/recentes → re-processa
 *  - Orders dos últimos 7 dias → re-processa
 *
 * 10min escolhido pra garantir resposta dentro do prazo do marketplace
 * mesmo quando o bot não responde e operador SAC precisa entrar.
 */
@Injectable()
export class TikTokSyncJob {
  private readonly logger = new Logger(TikTokSyncJob.name);

  constructor(
    private readonly env: EnvService,
    private readonly integracoes: IntegracoesService,
    private readonly orders: TikTokOrdersService,
    private readonly returns: TikTokReturnsService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('*/10 * * * *', { name: 'tiktok-sync-fallback', timeZone: 'UTC' })
  async fallback(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // AUDITORIA P0-5: TTL 9min — antes da próxima execução
    if (!(await this.cronLock.acquire('tiktok-sync-fallback', 9 * 60))) return;
    const ativas = await this.integracoes.listarAtivasPorServico('tiktok');
    if (ativas.length === 0) return;
    this.logger.debug(`Sync TikTok fallback: ${ativas.length} empresa(s)`);

    for (const { empresaId } of ativas) {
      try {
        await this.sincronizarEmpresa(empresaId);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`TikTok sync fallback empresa=${empresaId}: ${m}`);
      }
    }
  }

  async forcar(empresaId: string): Promise<{ orders: number; returns: number }> {
    return this.sincronizarEmpresa(empresaId);
  }

  private async sincronizarEmpresa(
    empresaId: string,
  ): Promise<{ orders: number; returns: number }> {
    let ordersCount = 0;
    try {
      const ids = await this.orders.listarRecentes(empresaId);
      if (ids.length > 0) {
        const detalhes = await this.orders.obterDetalhes(empresaId, ids);
        for (const o of detalhes) {
          await this.orders.processarOrder(empresaId, o);
          ordersCount++;
        }
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Orders fallback TikTok empresa=${empresaId}: ${m}`);
    }

    let returnsCount = 0;
    try {
      const rs = await this.returns.listar(empresaId);
      for (const r of rs) {
        await this.returns.processarReturn(empresaId, r);
        returnsCount++;
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Returns fallback TikTok empresa=${empresaId}: ${m}`);
    }

    return { orders: ordersCount, returns: returnsCount };
  }
}
