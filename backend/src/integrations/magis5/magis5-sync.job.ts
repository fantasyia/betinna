import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { Magis5OrdersService } from './magis5-orders.service';

/** Pedidos do Magis5 a cada 5 min (Léo, 03/11): só o que mudou. Sem webhook na API. */
@Injectable()
export class Magis5SyncJob {
  private readonly logger = new Logger(Magis5SyncJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pedidos: Magis5OrdersService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('0 */5 * * * *', { name: 'magis5-sync', timeZone: 'America/Sao_Paulo' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('magis5-sync', 4 * 60))) return;
    try {
      const conexoes = await this.prisma.integracaoConexao.findMany({
        where: { servico: 'magis5', ativo: true },
        select: { empresaId: true },
      });
      for (const { empresaId } of conexoes) {
        try {
          const r = await this.pedidos.sincronizar(empresaId);
          if (r.pedidos || r.falhas) {
            this.logger.log(`[Magis5] ${empresaId}: ${r.pedidos} pedidos, ${r.falhas} falhas`);
          }
        } catch (err) {
          this.logger.warn(`[Magis5] ${empresaId} falhou: ${String(err)}`);
        }
      }
    } finally {
      await this.cronLock.release('magis5-sync');
    }
  }
}
