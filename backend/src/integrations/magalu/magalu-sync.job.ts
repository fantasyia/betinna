import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { ehFalhaDeCredencial } from '../falha-credencial.util';
import { MagaluOrdersService } from './magalu-orders.service';
import { MagaluSacService } from './magalu-sac.service';

/** Janela: o que mudou nos últimos 2 dias (upsert = rodar de novo não duplica). */
const JANELA_MS = 2 * 86_400_000;

/**
 * Magalu a cada 30 min (14/11): pedidos → MarketplaceOrder e SAC → incidentes.
 * Roda no worker (ScheduleModule), com lock pra não rodar em dobro.
 */
@Injectable()
export class MagaluSyncJob {
  private readonly logger = new Logger(MagaluSyncJob.name);

  constructor(
    private readonly env: EnvService,
    private readonly integracoes: IntegracoesService,
    private readonly pedidos: MagaluOrdersService,
    private readonly sac: MagaluSacService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('0 */30 * * * *', { name: 'magalu-sync', timeZone: 'America/Sao_Paulo' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('magalu-sync', 25 * 60))) return;
    try {
      const ativas = await this.integracoes.listarAtivasPorServico('magalu');
      for (const { empresaId } of ativas) await this.sincronizarEmpresa(empresaId);
    } finally {
      await this.cronLock.release('magalu-sync');
    }
  }

  async sincronizarEmpresa(empresaId: string): Promise<{ pedidos: number; tickets: number }> {
    const desde = new Date(Date.now() - JANELA_MS);
    let pedidos = 0;
    let tickets = 0;
    const erros: string[] = [];
    try {
      pedidos = (await this.pedidos.sincronizar(empresaId, desde)).pedidos;
    } catch (err) {
      erros.push(`pedidos: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      tickets = (await this.sac.sincronizar(empresaId, desde)).tickets;
    } catch (err) {
      erros.push(`sac: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (erros.length) {
      const m = erros.join(' | ');
      this.logger.warn(`[Magalu] ${empresaId}: ${m}`);
      await this.integracoes
        .registrarSyncErro(empresaId, 'magalu', m, { desconectado: ehFalhaDeCredencial(m) })
        .catch(() => undefined);
    } else {
      this.logger.log(`[Magalu] ${empresaId}: ${pedidos} pedidos, ${tickets} tickets`);
      await this.integracoes.registrarSyncOk(empresaId, 'magalu').catch(() => undefined);
    }
    return { pedidos, tickets };
  }
}
