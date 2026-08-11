import { Module } from '@nestjs/common';
import { EmailModule } from '@integrations/email/email.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { BackupController } from './backup.controller';
import { BackupJob } from './backup.job';
import { BackupService } from './backup.service';

/**
 * BackupModule — backup automático diário do banco.
 *
 * PrismaService, EnvService e CronLockService vêm de módulos @Global.
 * EmailModule é importado pra usar o TransactionalEmailService (alerta de falha).
 * NotificacoesModule é o canal INDEPENDENTE do Resend (#77): se o e-mail não sai,
 * a falha de backup ainda aparece no sino do ADMIN/DIRECTOR.
 */
@Module({
  imports: [EmailModule, NotificacoesModule],
  controllers: [BackupController],
  providers: [BackupService, BackupJob],
  exports: [BackupService],
})
export class BackupModule {}
