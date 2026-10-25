import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { AvaliacoesService } from './avaliacoes.service';

/** Avaliações novas da Shopee, 1x por dia (madrugada), nas empresas com vitrine + Shopee. */
@Injectable()
export class AvaliacoesJob {
  private readonly logger = new Logger(AvaliacoesJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly avaliacoes: AvaliacoesService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('0 20 4 * * *', { name: 'avaliacoes-shopee', timeZone: 'America/Sao_Paulo' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('avaliacoes-shopee', 3000))) return;
    try {
      const conexoes = await this.prisma.integracaoConexao.findMany({
        where: { servico: 'shopee', ativo: true },
        select: { empresaId: true },
      });
      const comVitrine = new Set(
        (
          await this.prisma.vitrine.findMany({
            where: { empresaId: { in: conexoes.map((c) => c.empresaId) } },
            select: { empresaId: true },
          })
        ).map((v) => v.empresaId),
      );
      for (const { empresaId } of conexoes.filter((c) => comVitrine.has(c.empresaId))) {
        try {
          const r = await this.avaliacoes.importarShopee(empresaId);
          this.logger.log(
            `[avaliações] ${empresaId}: ${r.novas} novas, ${r.aprovadas} aprovadas pela IA`,
          );
        } catch (err) {
          this.logger.warn(`[avaliações] ${empresaId} falhou: ${String(err)}`);
        }
      }
    } finally {
      await this.cronLock.release('avaliacoes-shopee');
    }
  }
}
