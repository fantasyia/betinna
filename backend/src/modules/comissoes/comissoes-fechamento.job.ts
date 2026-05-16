import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { ComissoesService } from './comissoes.service';

/**
 * Cron mensal de fechamento de comissões.
 *
 * Roda **dia 1 às 04:00 UTC** (01:00 BRT) — fecha o mês ANTERIOR pra todas
 * as empresas com pedidos comissionáveis no período. `reprocessar=false` →
 * idempotente: se já fechou (manualmente, por exemplo), não reescreve.
 *
 * Falha em uma empresa não derruba o job — loga e segue.
 */
@Injectable()
export class ComissoesFechamentoJob {
  private readonly logger = new Logger(ComissoesFechamentoJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comissoes: ComissoesService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('0 4 1 * *', { name: 'comissoes-fechamento-mensal', timeZone: 'UTC' })
  async fecharMesAnterior(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // AUDITORIA P0-5 BullMQ: cron mensal só pode rodar em 1 réplica.
    // TTL 1h é suficiente — fechamento de 50 empresas leva &lt; 10min.
    if (!(await this.cronLock.acquire('comissoes-fechamento-mensal', 3600))) {
      return;
    }

    const agora = new Date();
    const anoAtual = agora.getUTCFullYear();
    const mesAtual = agora.getUTCMonth() + 1; // 1-12
    const mes = mesAtual === 1 ? 12 : mesAtual - 1;
    const ano = mesAtual === 1 ? anoAtual - 1 : anoAtual;

    const empresas = await this.prisma.empresa.findMany({
      where: { ativo: true },
      select: { id: true },
    });
    if (empresas.length === 0) {
      this.logger.debug('Fechamento mensal: nenhuma empresa ativa');
      return;
    }
    this.logger.log(`Fechamento mensal ${mes}/${ano} iniciado para ${empresas.length} empresa(s)`);

    let okCount = 0;
    let falhasCount = 0;
    for (const { id: empresaId } of empresas) {
      try {
        const systemUser: AuthenticatedUser = {
          id: 'system-cron',
          email: 'system@betinna.ai',
          nome: 'Cron Fechamento',
          role: 'ADMIN',
          empresaIds: [empresaId],
          empresaIdAtiva: empresaId,
        };
        await this.comissoes.fecharMes(systemUser, { mes, ano, reprocessar: false });
        okCount++;
      } catch (err) {
        falhasCount++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Fechamento ${mes}/${ano} falhou pra empresa ${empresaId}: ${msg}`);
      }
    }
    this.logger.log(
      `Fechamento mensal ${mes}/${ano} concluído: ${okCount} ok, ${falhasCount} falha(s)`,
    );
  }
}
