import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@database/prisma.service';
import { AppException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { CampanhasService } from './campanhas.service';

/**
 * Dispara campanhas agendadas cujo `agendadoPara` já passou.
 * Roda a cada 5 minutos.
 */
@Injectable()
export class CampanhaSchedulerJob {
  private readonly logger = new Logger(CampanhaSchedulerJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campanhas: CampanhasService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('*/5 * * * *', { name: 'campanha-scheduler-5min' })
  async avaliarAgendadas(): Promise<void> {
    // AUDITORIA P0-5: TTL 270s (4min30s) — antes da próxima execução.
    if (!(await this.cronLock.acquire('campanha-scheduler-5min', 270))) return;
    const agora = new Date();
    const pendentes = await this.prisma.campanha.findMany({
      where: {
        status: 'AGENDADA',
        agendadoPara: { lte: agora },
      },
      select: {
        id: true,
        empresaId: true,
        criadoPorId: true,
        nome: true,
      },
    });

    if (pendentes.length === 0) return;

    this.logger.log(`Scheduler: ${pendentes.length} campanha(s) agendada(s) para disparar`);

    for (const c of pendentes) {
      try {
        // Constrói um AuthenticatedUser mínimo com o contexto da empresa
        const systemUser: AuthenticatedUser = {
          id: c.criadoPorId,
          email: 'system@betinna.ai',
          nome: 'Sistema',
          role: 'ADMIN',
          empresaIds: [c.empresaId],
          empresaIdAtiva: c.empresaId,
        };
        await this.campanhas.disparar(systemUser, c.id);
        this.logger.log(`Campanha "${c.nome}" (${c.id}) disparada pelo scheduler`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Erro ao disparar campanha ${c.id}: ${msg}`);
        // CAÇADA-BUG #41: checava `msg.includes('CAMPANHA_SEM_DESTINATARIOS')`, mas `msg` é o TEXTO
        // humano do erro ("Nenhum destinatário encontrado…") — o code fica em `err.code`. O branch era
        // MORTO → a campanha agendada com 0 destinatários voltava pra RASCUNHO (revert do disparar) e o
        // agendamento evaporava sem sinal. Agora detecta pelo code e marca CANCELADA (pretendido).
        if (err instanceof AppException && err.code === ErrorCode.CAMPANHA_SEM_DESTINATARIOS) {
          await this.prisma.campanha.update({
            where: { id: c.id },
            data: { status: 'CANCELADA' },
          });
          this.logger.warn(
            `Campanha "${c.nome}" (${c.id}) CANCELADA pelo scheduler — segmento sem destinatários.`,
          );
        }
      }
    }
  }
}
