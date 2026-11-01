import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { SheinOrdersService } from './shein-orders.service';

/**
 * Pedidos da Shein a cada 30 min: os que mudaram nas últimas 48 h (uma janela).
 * Só loja autorizada (com openKeyId da loja). Roda no worker — o IP de saída
 * dele também precisa estar na lista branca da Shein.
 */
@Injectable()
export class SheinSyncJob {
  private readonly logger = new Logger(SheinSyncJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pedidos: SheinOrdersService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('0 15,45 * * * *', { name: 'shein-sync', timeZone: 'America/Sao_Paulo' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('shein-sync', 25 * 60))) return;
    try {
      const conexoes = await this.prisma.integracaoConexao.findMany({
        where: { servico: 'shein', ativo: true, externalAccountId: { not: null } },
        select: { empresaId: true },
      });
      const desde = new Date(Date.now() - 47 * 3_600_000);
      for (const { empresaId } of conexoes) {
        try {
          const r = await this.pedidos.sincronizar(empresaId, desde, 2);
          this.logger.log(`[Shein] ${empresaId}: ${r.pedidos} pedidos, ${r.falhas} falhas`);
        } catch (err) {
          this.logger.warn(`[Shein] ${empresaId} falhou: ${String(err)}`);
        }
      }
    } finally {
      await this.cronLock.release('shein-sync');
    }
  }
}
