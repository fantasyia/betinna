import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { EvolutionInstanciaService } from './evolution-instancia.service';
import { EvolutionService } from './evolution.service';

/**
 * Cron de SYNC das instâncias Evolution (a cada 10min). O webhook CONNECTION_UPDATE já mantém a
 * tabela fresca em TEMPO-REAL, mas instâncias que não MUDAM de estado (ex.: já `open` há muito) nunca
 * disparam o evento — o sync garante que a tabela reflita TODAS as instâncias + o ownerJid atual.
 *
 * Read-only do lado do Evolution (não reseta/desconecta nada): só persiste o estado. O auto-reset de
 * zumbi é destrutivo (logout+delete+restart) → fica como follow-up 2.2b com guards próprios; aqui só
 * LOGA os candidatos a zumbi.
 *
 * Só roda com WHATSAPP_PROVIDER=evolution + lock distribuído (um processo por janela).
 */
@Injectable()
export class EvolutionInstanciasSyncJob {
  private readonly logger = new Logger(EvolutionInstanciasSyncJob.name);

  constructor(
    private readonly evolution: EvolutionService,
    private readonly instancias: EvolutionInstanciaService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('*/10 * * * *', { name: 'evolution-instancias-sync' })
  async sincronizar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (this.env.get('WHATSAPP_PROVIDER') !== 'evolution') return;
    // Lock 9min (< intervalo 10min) → um só processo sincroniza por janela.
    if (!(await this.cronLock.acquire('evolution-instancias-sync', 540))) return;
    try {
      const lista = await this.evolution.listarInstanciasDetalhadas();
      let zumbis = 0;
      for (const i of lista) {
        await this.instancias.sincronizarConexao(i.name, i.connectionStatus ?? 'close', i.ownerJid);
        // Zumbi = 'open' mas com motivo de desconexão (deslogado). Só LOGA (reset destrutivo = 2.2b).
        if (i.connectionStatus === 'open' && i.disconnectionReasonCode != null) {
          zumbis += 1;
          this.logger.warn(
            `[evolution] instância ${i.name} parece ZUMBI (open + reason ${i.disconnectionReasonCode}) — precisa reconectar`,
          );
        }
      }
      if (lista.length > 0) {
        this.logger.log(
          `[evolution] sync de instâncias: ${lista.length} sincronizada(s), ${zumbis} zumbi(s)`,
        );
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[evolution] sync de instâncias falhou: ${m}`);
    }
  }
}
