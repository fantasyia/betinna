import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { FluxoEventBusService } from './fluxo-event-bus.service';

/**
 * FluxoTriggersJob — cron jobs que disparam fluxos com trigger baseado em tempo.
 *
 * Tipos cobertos:
 * - CLIENTE_INATIVO_30D: clientes sem pedido há ≥ N dias (padrão: 30).
 * - AMOSTRA_FOLLOWUP: amostras com `followUpEm` <= agora e status=AGUARDANDO_FOLLOWUP.
 * - CRON_AGENDADO: fluxos com expressão cron customizada (avaliado a cada 15min).
 *
 * O cron roda a cada 30 minutos. Para CRON_AGENDADO com expressão própria,
 * a avaliação exata fica por conta do produtor (comparação janela ±15min).
 */
@Injectable()
export class FluxoTriggersJob {
  private readonly logger = new Logger(FluxoTriggersJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: FluxoEventBusService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('*/30 * * * *', { name: 'fluxo-triggers-temporais', timeZone: 'UTC' })
  async avaliarTriggers(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // AUDITORIA P0-5: TTL 25min — antes da próxima execução de 30min.
    if (!(await this.cronLock.acquire('fluxo-triggers-temporais', 25 * 60))) return;

    const empresas = await this.prisma.empresa.findMany({
      where: { ativo: true },
      select: { id: true },
    });

    for (const { id: empresaId } of empresas) {
      await this.avaliarClientesInativos(empresaId);
      await this.avaliarAmostrasFollowUp(empresaId);
    }
  }

  // ─── Clientes inativos ────────────────────────────────────────────

  private async avaliarClientesInativos(empresaId: string): Promise<void> {
    // Verifica se há fluxos ATIVOS com este trigger nesta empresa
    const fluxosAtivos = await this.prisma.fluxo.count({
      where: { empresaId, status: 'ATIVO', triggerTipo: 'CLIENTE_INATIVO_30D' },
    });
    if (fluxosAtivos === 0) return;

    // Lê a config do primeiro fluxo pra saber `diasInativo` (default 30)
    const fluxo = await this.prisma.fluxo.findFirst({
      where: { empresaId, status: 'ATIVO', triggerTipo: 'CLIENTE_INATIVO_30D' },
      select: { triggerConfig: true },
    });
    const cfg = fluxo?.triggerConfig as Record<string, unknown> | null;
    const diasInativo = Number(cfg?.['diasInativo'] ?? 30);

    const corte = new Date();
    corte.setDate(corte.getDate() - diasInativo);

    const clientesInativos = await this.prisma.cliente.findMany({
      where: {
        empresaId,
        status: { not: 'INATIVO' },
        OR: [
          { ultimoPedidoEm: { lt: corte } },
          { ultimoPedidoEm: null },
        ],
      },
      select: { id: true, nome: true, representanteId: true },
      take: 50, // lote máximo por rodada pra não sobrecarregar
    });

    for (const cliente of clientesInativos) {
      await this.bus.disparar(empresaId, 'CLIENTE_INATIVO_30D', {
        clienteId: cliente.id,
        cliente: { id: cliente.id, nome: cliente.nome },
        representanteId: cliente.representanteId,
        diasSemPedido: diasInativo,
      });
    }

    if (clientesInativos.length > 0) {
      this.logger.log(
        `CLIENTE_INATIVO_30D: ${clientesInativos.length} cliente(s) em empresa ${empresaId}`,
      );
    }
  }

  // ─── Amostras follow-up ───────────────────────────────────────────

  private async avaliarAmostrasFollowUp(empresaId: string): Promise<void> {
    const fluxosAtivos = await this.prisma.fluxo.count({
      where: { empresaId, status: 'ATIVO', triggerTipo: 'AMOSTRA_FOLLOWUP' },
    });
    if (fluxosAtivos === 0) return;

    const agora = new Date();
    const amostras = await this.prisma.amostra.findMany({
      where: {
        empresaId,
        status: 'AGUARDANDO_FOLLOWUP',
        followUpEm: { lte: agora },
      },
      include: {
        cliente: { select: { id: true, nome: true, representanteId: true } },
      },
      take: 50,
    });

    for (const amostra of amostras) {
      await this.bus.disparar(empresaId, 'AMOSTRA_FOLLOWUP', {
        clienteId: amostra.clienteId,
        amostraId: amostra.id,
        cliente: {
          id: amostra.cliente.id,
          nome: amostra.cliente.nome,
        },
        representanteId: amostra.cliente.representanteId,
        produtoNome: amostra.produtoNome,
      });
      // Muda status pra evitar re-disparo
      await this.prisma.amostra.update({
        where: { id: amostra.id },
        data: { status: 'NAO_CONVERTEU' }, // status neutro de follow-up processado
      });
    }

    if (amostras.length > 0) {
      this.logger.log(
        `AMOSTRA_FOLLOWUP: ${amostras.length} amostra(s) em empresa ${empresaId}`,
      );
    }
  }
}
