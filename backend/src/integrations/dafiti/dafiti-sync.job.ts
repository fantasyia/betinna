import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { DafitiOrdersService } from './dafiti-orders.service';

/**
 * Pedidos da Dafiti 1x por semana, segunda às 06:00, com os que mudaram nos
 * últimos 8 dias (Léo, 02/11: a API só conta os pedidos do galpão e devolve a
 * lista vazia até a Dafiti liberar as Coletas; de 30 em 30 min era desperdício).
 */
@Injectable()
export class DafitiSyncJob {
  private readonly logger = new Logger(DafitiSyncJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pedidos: DafitiOrdersService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('0 0 6 * * 1', { name: 'dafiti-sync', timeZone: 'America/Sao_Paulo' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('dafiti-sync', 25 * 60))) return;
    try {
      const conexoes = await this.prisma.integracaoConexao.findMany({
        where: { servico: 'dafiti', ativo: true },
        select: { empresaId: true },
      });
      const desde = new Date(Date.now() - 8 * 86_400_000);
      for (const { empresaId } of conexoes) {
        try {
          const r = await this.pedidos.sincronizar(empresaId, desde);
          this.logger.log(`[Dafiti] ${empresaId}: ${r.pedidos} pedidos`);
        } catch (err) {
          this.logger.warn(`[Dafiti] ${empresaId} falhou: ${String(err)}`);
        }
      }
    } finally {
      await this.cronLock.release('dafiti-sync');
    }
  }
}
