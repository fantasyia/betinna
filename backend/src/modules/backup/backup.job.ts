import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { BackupService } from './backup.service';

/**
 * Cron de backup diário do banco.
 *
 * Roda **todos os dias às 03:00 UTC** (00:00 BRT) — horário de menor uso, antes
 * do fechamento de comissões (dia 1 às 04:00) e da purga LGPD (dia 2 às 05:00).
 *
 * `CronLockService` (Redis SETNX) garante execução em 1 réplica só (TTL 30min
 * cobre dumps grandes). Em falha, o `BackupService` alerta por e-mail + Sentry.
 *
 * Desabilitável via `BACKUP_ENABLED=false` (default: ligado).
 */
@Injectable()
export class BackupJob {
  private readonly logger = new Logger(BackupJob.name);

  constructor(
    private readonly backup: BackupService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('0 3 * * *', { name: 'backup-diario', timeZone: 'UTC' })
  async rodarBackupDiario(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (this.env.get('BACKUP_ENABLED') === false) {
      this.logger.log('Backup diário desabilitado (BACKUP_ENABLED=false) — pulando.');
      return;
    }
    // 1 réplica só. TTL 30min cobre dumps grandes.
    if (!(await this.cronLock.acquire('backup-diario', 1800))) {
      return;
    }

    this.logger.log('Backup diário iniciado…');
    const r = await this.backup.executar();
    if (r.ok) {
      this.logger.log(`Backup diário concluído: ${r.result?.path}`);
    } else {
      // Erro já foi logado/alertado dentro do service; aqui só registra o fim.
      this.logger.error(`Backup diário terminou com falha: ${r.erro}`);
    }
  }

  /**
   * Verifica a INTEGRIDADE do backup mais recente — 30min após o backup das 03:00. Sem isto,
   * a restaurabilidade nunca era comprovada (backup que não restaura = não ter backup).
   */
  @Cron('30 3 * * *', { name: 'backup-verificacao', timeZone: 'UTC' })
  async verificarBackupDiario(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (this.env.get('BACKUP_ENABLED') === false) return;
    // 1 réplica só; TTL 10min cobre a verificação.
    if (!(await this.cronLock.acquire('backup-verificacao', 600))) {
      return;
    }
    this.logger.log('Verificação de integridade do backup iniciada…');
    await this.backup.verificarEAlertar();
  }
}
