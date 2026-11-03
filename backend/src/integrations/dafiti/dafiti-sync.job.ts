import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { DafitiOrdersService } from './dafiti-orders.service';

/**
 * Desligado (Léo, 02/11): a API só conta os pedidos do galpão, não entrega o
 * conteúdo. Volta quando a Dafiti liberar as Coletas — aí é só trocar pra true.
 */
const SINCRONIZAR_DAFITI = false;

/** Pedidos da Dafiti a cada 30 min (os que mudaram nos últimos 3 dias). */
@Injectable()
export class DafitiSyncJob {
  private readonly logger = new Logger(DafitiSyncJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pedidos: DafitiOrdersService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('0 */30 * * * *', { name: 'dafiti-sync', timeZone: 'America/Sao_Paulo' })
  async rodar(): Promise<void> {
    if (!SINCRONIZAR_DAFITI || this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('dafiti-sync', 25 * 60))) return;
    try {
      const conexoes = await this.prisma.integracaoConexao.findMany({
        where: { servico: 'dafiti', ativo: true },
        select: { empresaId: true },
      });
      const desde = new Date(Date.now() - 3 * 86_400_000);
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
