import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { MLClaimsService } from './ml-claims.service';
import { MLClientService } from './ml-client.service';
import { MLOrdersService } from './ml-orders.service';
import { MLQuestionsService } from './ml-questions.service';

/**
 * Cron de fallback do Mercado Livre.
 *
 * Webhooks ML podem falhar/atrasar — o ML tenta 8x mas em produção é comum
 * perder eventos. Esse job roda a cada 10 min pra:
 *  - Listar claims abertas e re-processar (status sync + chat messages)
 *  - Listar pedidos recentes (últimos 30 dias) e re-processar
 *  - Listar perguntas não respondidas e re-processar
 *
 * 10min é o intervalo escolhido pra garantir resposta dentro do prazo do
 * marketplace (ML penaliza resposta lenta no reputation) mesmo quando o bot
 * (MullerBot) não responder e um operador SAC precisar entrar.
 *
 * Cada empresa com `IntegracaoConexao(servico=mercadolivre)` ativa entra na fila.
 * Falha em uma empresa não derruba o job — loga warn e segue.
 */
@Injectable()
export class MLSyncJob {
  private readonly logger = new Logger(MLSyncJob.name);

  constructor(
    private readonly env: EnvService,
    private readonly integracoes: IntegracoesService,
    private readonly client: MLClientService,
    private readonly questions: MLQuestionsService,
    private readonly orders: MLOrdersService,
    private readonly claims: MLClaimsService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('*/10 * * * *', { name: 'ml-sync-fallback', timeZone: 'UTC' })
  async fallback(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // AUDITORIA P0-5: TTL 9min — antes da próxima execução (10min).
    if (!(await this.cronLock.acquire('ml-sync-fallback', 9 * 60))) return;
    const ativas = await this.integracoes.listarAtivasPorServico('mercadolivre');
    if (ativas.length === 0) return;
    this.logger.debug(`Sync ML fallback: ${ativas.length} empresa(s)`);

    for (const { empresaId } of ativas) {
      try {
        await this.sincronizarEmpresa(empresaId);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`ML sync fallback empresa=${empresaId}: ${m}`);
      }
    }
  }

  /** Disparo manual (admin/diagnóstico). */
  async forcar(empresaId: string): Promise<{
    claims: number;
    orders: number;
    questions: number;
  }> {
    return this.sincronizarEmpresa(empresaId);
  }

  private async sincronizarEmpresa(empresaId: string): Promise<{
    claims: number;
    orders: number;
    questions: number;
  }> {
    const creds = await this.client.getCredenciais(empresaId);
    const sellerId = creds.userId;

    // Claims abertas
    let claimsCount = 0;
    try {
      const claims = await this.claims.listarAbertas(empresaId);
      for (const c of claims) {
        await this.claims.processarClaim(empresaId, c);
        claimsCount++;
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Claims fallback empresa=${empresaId}: ${m}`);
    }

    // Pedidos recentes
    let ordersCount = 0;
    try {
      const list = await this.orders.listarRecentes(empresaId, sellerId);
      for (const o of list) {
        await this.orders.processarOrder(empresaId, o);
        ordersCount++;
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Orders fallback empresa=${empresaId}: ${m}`);
    }

    // Perguntas não respondidas
    let questionsCount = 0;
    try {
      const qs = await this.questions.listarNaoRespondidas(empresaId, sellerId);
      for (const q of qs) {
        await this.questions.processarQuestion(empresaId, q);
        questionsCount++;
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Questions fallback empresa=${empresaId}: ${m}`);
    }

    return { claims: claimsCount, orders: ordersCount, questions: questionsCount };
  }
}
