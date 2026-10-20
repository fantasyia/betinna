import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { DIAS_DE_AVISO, diasParaVencer } from './credencial-validade';
import { IntegracaoStatusService } from './integracao-status.service';
import { IntegracoesService } from './integracoes.service';

/**
 * Aviso de token PERTO DE VENCER (renovação manual — hoje, o Melhor Envio).
 *
 * Roda 1x por dia e manda e-mail ao diretor a 30, 7 e 1 dia do vencimento e no
 * dia em que vence. Sem isto o token de 1 ano do Melhor Envio vencia calado e o
 * frete da vitrine parava de cotar (20/10).
 */
@Injectable()
export class ValidadeCredencialJob {
  private readonly logger = new Logger(ValidadeCredencialJob.name);

  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly status: IntegracaoStatusService,
    private readonly cronLock: CronLockService,
    private readonly env: EnvService,
  ) {}

  @Cron('0 0 9 * * *', { name: 'validade-credencial', timeZone: 'America/Sao_Paulo' })
  async rodar(agora = new Date()): Promise<number> {
    if (this.env.get('NODE_ENV') === 'test') return 0;
    if (!(await this.cronLock.acquire('validade-credencial', 600))) return 0;
    try {
      return await this.avisar(agora);
    } catch (err) {
      this.logger.warn(`[validade] falhou: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    } finally {
      await this.cronLock.release('validade-credencial');
    }
  }

  /** Separado do cron pra ser testável. Devolve quantos avisos saíram. */
  async avisar(agora = new Date()): Promise<number> {
    let enviados = 0;
    for (const v of await this.integracoes.validadesManuais()) {
      const dias = diasParaVencer(v.expiraEm, agora);
      if (!(DIAS_DE_AVISO as readonly number[]).includes(dias)) continue;
      await this.status
        .alertarValidade(v.empresaId, v.servico, v.expiraEm, dias)
        .then(() => enviados++)
        .catch((err) =>
          this.logger.warn(
            `[validade] aviso de ${v.servico} (${v.empresaId}) falhou: ${String(err)}`,
          ),
        );
    }
    return enviados;
  }
}
