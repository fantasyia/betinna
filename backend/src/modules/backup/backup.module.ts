import { Module } from '@nestjs/common';
import { EmailModule } from '@integrations/email/email.module';
import { BackupJob } from './backup.job';
import { BackupService } from './backup.service';

/**
 * BackupModule — backup automático diário do banco.
 *
 * PrismaService, EnvService e CronLockService vêm de módulos @Global.
 * EmailModule é importado pra usar o TransactionalEmailService (alerta de falha).
 */
@Module({
  imports: [EmailModule],
  providers: [BackupService, BackupJob],
  exports: [BackupService],
})
export class BackupModule {}
