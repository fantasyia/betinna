import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { ShopeeOrdersService } from './shopee-orders.service';
import { ShopeeReturnsService } from './shopee-returns.service';

/**
 * Cron fallback Shopee a cada 10 min:
 *  - Re-processa returns abertas (status REQUESTED, JUDGING, SELLER_DISPUTE)
 *  - Re-processa pedidos recentes (15 dias)
 *
 * Intervalo 10min garante resposta dentro do prazo do marketplace mesmo
 * quando o bot não responde e um operador SAC precisa entrar manualmente.
 *
 * Chat NÃO é re-processado em cron (volume potencialmente alto). Webhooks
 * são confiáveis pra chat na maioria dos casos. Se necessário no futuro,
 * podemos adicionar pull de conversations não-lidas.
 */
@Injectable()
export class ShopeeSyncJob {
  private readonly logger = new Logger(ShopeeSyncJob.name);

  constructor(
    private readonly env: EnvService,
    private readonly integracoes: IntegracoesService,
    private readonly returns: ShopeeReturnsService,
    private readonly orders: ShopeeOrdersService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('*/10 * * * *', { name: 'shopee-sync-fallback', timeZone: 'UTC' })
  async fallback(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // AUDITORIA P0-5: TTL 9min — antes da próxima execução
    if (!(await this.cronLock.acquire('shopee-sync-fallback', 9 * 60))) return;
    const ativas = await this.integracoes.listarAtivasPorServico('shopee');
    if (ativas.length === 0) return;
    this.logger.debug(`Sync Shopee fallback: ${ativas.length} empresa(s)`);

    for (const { empresaId } of ativas) {
      try {
        await this.sincronizarEmpresa(empresaId);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Shopee sync fallback empresa=${empresaId}: ${m}`);
      }
    }
  }

  async forcar(empresaId: string): Promise<{ returns: number; orders: number }> {
    return this.sincronizarEmpresa(empresaId);
  }

  private async sincronizarEmpresa(empresaId: string): Promise<{
    returns: number;
    orders: number;
  }> {
    let returnsCount = 0;
    try {
      const rs = await this.returns.listar(empresaId);
      for (const r of rs) {
        await this.returns.processarReturn(empresaId, r);
        returnsCount++;
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Returns fallback empresa=${empresaId}: ${m}`);
    }

    let ordersCount = 0;
    try {
      const sns = await this.orders.listarRecentes(empresaId);
      if (sns.length > 0) {
        // Pega em lotes de 50 (limite da Shopee)
        for (let i = 0; i < sns.length; i += 50) {
          const slice = sns.slice(i, i + 50);
          const detalhes = await this.orders.obterDetalhes(empresaId, slice);
          for (const o of detalhes) {
            await this.orders.processarOrder(empresaId, o);
            ordersCount++;
          }
        }
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Orders fallback empresa=${empresaId}: ${m}`);
    }

    return { returns: returnsCount, orders: ordersCount };
  }
}
