import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';
import { captureException } from '@shared/observability/sentry';
import { runBackup, restoreTest, type BackupResult, type RestoreTestResult } from './backup-core';

/**
 * BackupService — orquestra o backup diário do banco.
 *
 * - `executar()`: roda o backup (pg_dump → Supabase Storage → retenção) e, se
 *   falhar, **alerta por e-mail** o responsável (BACKUP_ALERT_EMAIL ou o
 *   primeiro ADMIN ativo) + Sentry. Nunca lança — devolve sucesso/erro.
 * - `verificarUltimoBackup()`: testa a integridade do backup mais recente.
 *
 * Roda no Worker (onde os crons vivem). `pg_dump`/`pg_restore` já vêm na imagem
 * Docker via `postgresql-client`.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly email: TransactionalEmailService,
  ) {}

  /**
   * Executa o backup. Não lança — em falha, alerta e devolve `{ ok: false }`.
   */
  async executar(): Promise<{ ok: boolean; result?: BackupResult; erro?: string }> {
    try {
      const result = await runBackup();
      const mb = (result.bytes / 1024 / 1024).toFixed(2);
      this.logger.log(`Backup OK: ${result.path} (${mb} MB em ${result.durationMs}ms)`);
      return { ok: true, result };
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err);
      this.logger.error(`Backup FALHOU: ${erro}`);
      captureException(err, { contexto: 'backup-diario' });
      await this.alertarFalha(erro);
      return { ok: false, erro };
    }
  }

  /**
   * Verifica a integridade do último backup (sem tocar produção).
   */
  async verificarUltimoBackup(): Promise<RestoreTestResult> {
    return restoreTest();
  }

  /**
   * Resolve o destinatário do alerta e envia o e-mail de falha (best-effort).
   * Prioridade: BACKUP_ALERT_EMAIL → primeiro ADMIN ativo.
   */
  private async alertarFalha(erro: string): Promise<void> {
    const para = await this.resolverDestinatario();
    if (!para) {
      this.logger.warn(
        'Backup falhou e não há destinatário de alerta (defina BACKUP_ALERT_EMAIL ou tenha um ADMIN ativo).',
      );
      return;
    }
    const quando = new Date().toISOString();
    await this.email.enviarAlertaSistema({
      para,
      assunto: '🚨 Falha no backup automático do banco — Betinna.ai',
      titulo: 'Backup automático falhou',
      mensagem:
        `O backup automático do banco de dados <strong>não foi concluído</strong>.<br><br>` +
        `<strong>Quando:</strong> ${quando} (UTC)<br>` +
        `<strong>Erro:</strong> ${this.escapeHtml(erro)}<br><br>` +
        `Por favor verifique o serviço o quanto antes — sem backup, uma falha no banco ` +
        `não tem recuperação. Confira os logs do Worker no Railway.`,
    });
    this.logger.log(`Alerta de falha de backup enviado para ${para}`);
  }

  private async resolverDestinatario(): Promise<string | null> {
    const configurado = this.env.get('BACKUP_ALERT_EMAIL');
    if (configurado && configurado.length > 0) return configurado;

    const admin = await this.prisma.usuario.findFirst({
      where: { role: 'ADMIN', status: 'ATIVO' },
      orderBy: { criadoEm: 'asc' },
      select: { email: true },
    });
    return admin?.email ?? null;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
