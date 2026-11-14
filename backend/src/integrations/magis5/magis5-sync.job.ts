import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { Magis5EstoqueService } from './magis5-estoque.service';
import { Magis5OrdersService } from './magis5-orders.service';
import { Magis5VitrineService } from './magis5-vitrine.service';

/**
 * A cada 5 min (Léo, 03/11): vitrine paga sobe e o que mudou no Magis5 desce. Sem webhook na API.
 * Depois da leitura (14/11): reserva até a NF e, com a chave ligada, o saldo sobe.
 * Nessa ordem e no mesmo lock: o envio é "saldo por cima", e mandar antes de ler
 * devolveria ao anúncio uma peça que acabou de ser vendida.
 */
@Injectable()
export class Magis5SyncJob {
  private readonly logger = new Logger(Magis5SyncJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pedidos: Magis5OrdersService,
    private readonly vitrine: Magis5VitrineService,
    private readonly estoque: Magis5EstoqueService,
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
          const n = await this.vitrine.enviarPagos(empresaId);
          if (n) this.logger.log(`[Magis5] ${empresaId}: ${n} pedidos da vitrine enviados`);
        } catch (err) {
          this.logger.warn(`[Magis5] vitrine ${empresaId} falhou: ${String(err)}`);
        }
        let leu = false;
        try {
          const r = await this.pedidos.sincronizar(empresaId);
          leu = true;
          if (r.pedidos || r.falhas) {
            this.logger.log(`[Magis5] ${empresaId}: ${r.pedidos} pedidos, ${r.falhas} falhas`);
          }
        } catch (err) {
          this.logger.warn(`[Magis5] ${empresaId} falhou: ${String(err)}`);
        }
        // Leitura falhou: nada de reserva nem envio com pedido velho.
        if (!leu) continue;
        try {
          await this.estoque.reconciliar(empresaId);
          const env = await this.estoque.enviarSaldos(empresaId);
          if (env.enviados)
            this.logger.log(`[Magis5] ${empresaId}: ${env.enviados} saldos enviados`);
        } catch (err) {
          this.logger.warn(`[Magis5] estoque ${empresaId} falhou: ${String(err)}`);
        }
      }
    } finally {
      await this.cronLock.release('magis5-sync');
    }
  }
}
