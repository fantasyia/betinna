import { Module } from '@nestjs/common';
import { SendGridModule } from '@integrations/sendgrid/sendgrid.module';
import { BackupJob } from './backup.job';
import { BackupService } from './backup.service';

/**
 * BackupModule — backup automático diário do banco.
 *
 * PrismaService, EnvService e CronLockService vêm de módulos @Global.
 * SendGridModule é importado pra usar o TransactionalEmailService (alerta de falha).
 */
@Module({
  imports: [SendGridModule],
  providers: [BackupService, BackupJob],
  exports: [BackupService],
})
export class BackupModule {}
