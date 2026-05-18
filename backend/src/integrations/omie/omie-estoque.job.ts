import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { OmieProdutosService } from './omie-produtos.service';

/**
 * Cron de 30 em 30 min que ressincroniza ESTOQUE dos produtos via OMIE.
 *
 * - Roda incremental (filtra `data_alteracao > ultimoSync`)
 * - Cobre o caso de webhook perdido / OMIE não suportar webhook de estoque
 *   em alguns planos / mudança massiva sem trigger granular
 * - Lock TTL 25min impede sobreposição se a sync anterior ainda estiver rodando
 *
 * Coexiste com `OmieSyncJob` (04:00 UTC, sync completo clientes+produtos).
 * Este cron foca em estoque pra que o rep tenha visibilidade rápida (≤30min).
 *
 * Em `OMIE_DEMO_MODE=true` continua rodando (dados mock, idempotente).
 */
@Injectable()
export class OmieEstoqueJob {
  private readonly logger = new Logger(OmieEstoqueJob.name);

  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly produtos: OmieProdutosService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('*/30 * * * *', { name: 'omie-estoque-30min', timeZone: 'UTC' })
  async sincronizarEstoque(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // Lock TTL 25min — próximo run (30min depois) sempre pode adquirir.
    if (!(await this.cronLock.acquire('omie-estoque-30min', 25 * 60))) return;

    const ativas = await this.integracoes.listarAtivasPorServico('omie');
    if (ativas.length === 0) {
      this.logger.debug('Sync estoque OMIE 30min: nenhuma empresa com integração ativa');
      return;
    }

    let ok = 0;
    let falhas = 0;
    for (const { empresaId } of ativas) {
      try {
        await this.produtos.sync(empresaId, { modo: 'incremental' });
        ok++;
      } catch (err) {
        falhas++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Sync estoque OMIE empresa ${empresaId} falhou: ${msg}`);
      }
    }
    if (ok > 0 || falhas > 0) {
      this.logger.log(`Sync estoque OMIE 30min concluído: ${ok} ok, ${falhas} falha(s)`);
    }
  }
}
