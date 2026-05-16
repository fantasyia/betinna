import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { OmieClientesService } from './omie-clientes.service';
import { OmieProdutosService } from './omie-produtos.service';

/**
 * Cron diário que ressincroniza clientes + produtos do OMIE pra todas as
 * empresas com integração ativa.
 *
 * Critério: 04:00 UTC = 01:00 BRT — fora do horário comercial em qualquer fuso.
 * Falha em uma empresa não derruba o job — loga e segue.
 *
 * Em `OMIE_DEMO_MODE=true` o sync continua rodando (recarrega dados mock,
 * idempotente, sem custo) — útil pra validar pipeline no Railway preview.
 */
@Injectable()
export class OmieSyncJob {
  private readonly logger = new Logger(OmieSyncJob.name);

  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly clientes: OmieClientesService,
    private readonly produtos: OmieProdutosService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('0 4 * * *', { name: 'omie-sync-diario', timeZone: 'UTC' })
  async ressincronizarTodas(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // AUDITORIA P0-5: sync diário só pode rodar uma vez (TTL 23h).
    if (!(await this.cronLock.acquire('omie-sync-diario', 23 * 3600))) return;

    const ativas = await this.integracoes.listarAtivasPorServico('omie');
    if (ativas.length === 0) {
      this.logger.debug('Sync OMIE diário: nenhuma empresa com integração ativa');
      return;
    }
    this.logger.log(`Sync OMIE diário iniciado: ${ativas.length} empresa(s)`);

    let okCount = 0;
    let falhasCount = 0;
    for (const { empresaId } of ativas) {
      try {
        // Cron diário: sempre incremental pra evitar custo de re-importar tudo
        await this.clientes.sync(empresaId, { modo: 'incremental' });
        await this.produtos.sync(empresaId, { modo: 'incremental' });
        okCount++;
      } catch (err) {
        falhasCount++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Sync OMIE falhou pra empresa ${empresaId}: ${msg}`);
      }
    }
    this.logger.log(
      `Sync OMIE diário concluído: ${okCount} ok, ${falhasCount} falha(s)`,
    );
  }

  /**
   * Disparo manual usado por testes/admin (atalho que NÃO é cron).
   * Mesmo comportamento do cron.
   */
  async forcarRessincronizacao(): Promise<{ ok: number; falhas: number }> {
    const ativas = await this.integracoes.listarAtivasPorServico('omie');
    let ok = 0;
    let falhas = 0;
    for (const { empresaId } of ativas) {
      try {
        // Cron diário: sempre incremental pra evitar custo de re-importar tudo
        await this.clientes.sync(empresaId, { modo: 'incremental' });
        await this.produtos.sync(empresaId, { modo: 'incremental' });
        ok++;
      } catch {
        falhas++;
      }
    }
    return { ok, falhas };
  }
}

// Re-exporta `CronExpression` (não usado aqui mas mantém compatibilidade
// caso queiramos alternar pra `CronExpression.EVERY_DAY_AT_4AM`).
void CronExpression;
