import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { CronLockService } from '@shared/utils/cron-lock.service';

/**
 * Cron LGPD — purga de dados antigos.
 *
 * Roda **dia 2 às 05:00 UTC** (02:00 BRT) — sai depois do fechamento de comissões
 * (dia 1 04:00 UTC) pra não competir por DB.
 *
 * Política (configurável por env, em meses; 0 desabilita):
 *   • LGPD_AUDIT_RETENTION_MONTHS         → AuditLog       (default 24m)
 *   • LGPD_MESSAGES_RETENTION_MONTHS      → Message        (default 24m)
 *   • LGPD_NOTIFICACOES_RETENTION_MONTHS  → Notificacao    (default 6m, só lidas)
 *
 * Atende:
 *   • LGPD Art. 16 — eliminação após cumprimento da finalidade
 *   • CCPA §1798.100(d) — retenção mínima necessária
 *
 * Auditoria: o próprio job loga total purgado no AuditLog (auto-referente),
 * com `usuario=system-cron` e `recurso=retention-cleanup`.
 *
 * Idempotente: rodar duas vezes no mesmo dia não causa problema (segundo run
 * encontra 0 registros elegíveis).
 *
 * Performance: usa `deleteMany` com filtro indexado em `criadoEm`. Para volumes
 * grandes (>1M rows), considerar trocar por batches de 10k via `take`.
 */
@Injectable()
export class RetentionCleanupJob {
  private readonly logger = new Logger(RetentionCleanupJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('0 5 2 * *', { name: 'retention-cleanup-mensal', timeZone: 'UTC' })
  async purgeOldRecords(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // Cron em 1 réplica só. TTL 30min cobre tabelas grandes.
    if (!(await this.cronLock.acquire('retention-cleanup-mensal', 1800))) {
      return;
    }

    const auditMonths = Number(this.env.get('LGPD_AUDIT_RETENTION_MONTHS'));
    const messagesMonths = Number(this.env.get('LGPD_MESSAGES_RETENTION_MONTHS'));
    const notificacoesMonths = Number(this.env.get('LGPD_NOTIFICACOES_RETENTION_MONTHS'));

    let totalPurged = 0;

    if (auditMonths > 0) {
      const cutoff = this.monthsAgo(auditMonths);
      try {
        const r = await this.prisma.auditLog.deleteMany({
          where: { criadoEm: { lt: cutoff } },
        });
        totalPurged += r.count;
        this.logger.log(`AuditLog purga: ${r.count} registros < ${cutoff.toISOString()}`);
      } catch (err) {
        this.logger.warn(`AuditLog purga falhou: ${this.errMsg(err)}`);
      }
    }

    if (messagesMonths > 0) {
      const cutoff = this.monthsAgo(messagesMonths);
      try {
        const r = await this.prisma.message.deleteMany({
          where: { criadoEm: { lt: cutoff } },
        });
        totalPurged += r.count;
        this.logger.log(`Message purga: ${r.count} registros < ${cutoff.toISOString()}`);
      } catch (err) {
        this.logger.warn(`Message purga falhou: ${this.errMsg(err)}`);
      }
    }

    if (notificacoesMonths > 0) {
      const cutoff = this.monthsAgo(notificacoesMonths);
      try {
        const r = await this.prisma.notificacao.deleteMany({
          where: {
            // Só purga notificações JÁ LIDAS antigas — não-lidas ficam por garantia
            lidaEm: { not: null },
            criadoEm: { lt: cutoff },
          },
        });
        totalPurged += r.count;
        this.logger.log(`Notificacao purga: ${r.count} registros lidos < ${cutoff.toISOString()}`);
      } catch (err) {
        this.logger.warn(`Notificacao purga falhou: ${this.errMsg(err)}`);
      }
    }

    if (totalPurged > 0) {
      // Auto-registra no AuditLog (transparência LGPD)
      try {
        await this.prisma.auditLog.create({
          data: {
            usuarioId: null,
            empresaId: null,
            acao: 'PURGE',
            recurso: 'retention-cleanup',
            recursoId: null,
            detalhes: {
              total: totalPurged,
              auditMonths,
              messagesMonths,
              notificacoesMonths,
            },
            ip: null,
          },
        });
      } catch {
        // Não derruba o job se o próprio audit falhar
      }
    }

    this.logger.log(`Retention cleanup concluído: ${totalPurged} registros purgados no total`);
  }

  private monthsAgo(months: number): Date {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - months);
    return d;
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
