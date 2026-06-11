import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import { ConversarIaService } from './conversar-ia.service';
import { proximaExecucaoCron, CRON_TZ_PADRAO } from './cron.util';

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
    private readonly email: TransactionalEmailService,
    private readonly conversarIa: ConversarIaService,
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
      await this.avaliarSlaEtapas(empresaId);
      await this.avaliarCronAgendado(empresaId);
    }

    // Orquestração (Fase B) — conversas de IA sem resposta além do timeout
    // disparam LEAD_SEM_RESPOSTA e são encerradas (consulta global, todas empresas).
    await this.conversarIa.processarTimeouts();
  }

  // ─── SLA por etapa (orquestração Fase B) ──────────────────────────

  /**
   * Aplica a ação de SLA vencido (FunilEtapa.acaoSlaExpirado) aos leads que
   * passaram do prazo (slaDias) na etapa atual. Tipos: mover / tag / notificar.
   * 'mover' tira o lead da etapa (não re-dispara); 'tag'/'notificar' são
   * idempotentes (LeadTag por chave).
   */
  private async avaliarSlaEtapas(empresaId: string): Promise<void> {
    const etapas = await this.prisma.funilEtapa.findMany({
      where: {
        funil: { empresaId },
        tipo: 'ATIVA',
        OR: [{ slaDias: { not: null } }, { slaHoras: { not: null } }],
      },
      select: { id: true, slaDias: true, slaHoras: true, acaoSlaExpirado: true },
    });
    for (const etapa of etapas) {
      const acao = etapa.acaoSlaExpirado as {
        tipo?: 'notificar' | 'mover' | 'tag';
        etapaDestinoId?: string;
        tagNome?: string;
      } | null;
      if (!acao?.tipo || (!etapa.slaDias && !etapa.slaHoras)) continue;

      // slaHoras tem precedência sobre slaDias (spec §2.1).
      const corte = new Date();
      if (etapa.slaHoras) corte.setHours(corte.getHours() - etapa.slaHoras);
      else corte.setDate(corte.getDate() - (etapa.slaDias as number));
      const leads = await this.prisma.lead.findMany({
        where: { empresaId, funilEtapaId: etapa.id, etapaDesde: { lt: corte } },
        select: { id: true },
        take: 100,
      });
      for (const lead of leads) {
        await this.aplicarAcaoSla(empresaId, lead.id, etapa.id, acao);
      }
      if (leads.length > 0) {
        this.logger.log(
          `SLA vencido: ${leads.length} lead(s) na etapa ${etapa.id} → ${acao.tipo} (empresa ${empresaId})`,
        );
      }
    }
  }

  private async aplicarAcaoSla(
    empresaId: string,
    leadId: string,
    etapaOrigemId: string,
    acao: { tipo?: string; etapaDestinoId?: string; tagNome?: string },
  ): Promise<void> {
    if (acao.tipo === 'mover' && acao.etapaDestinoId) {
      const destino = await this.prisma.funilEtapa.findFirst({
        where: { id: acao.etapaDestinoId, funil: { empresaId } },
        select: { id: true, funilId: true, tipo: true },
      });
      if (!destino) return;
      const etapaEnum =
        destino.tipo === 'GANHO' ? 'GANHO' : destino.tipo === 'PERDIDO' ? 'PERDIDO' : 'NOVO';
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { funilEtapaId: destino.id, etapa: etapaEnum, etapaDesde: new Date() },
      });
      // Nomes canônicos + funilId pra o filtro do gatilho "Lead mudou etapa" casar.
      await this.bus.disparar(empresaId, 'LEAD_ETAPA_MUDOU', {
        leadId,
        funilId: destino.funilId,
        deFunilEtapaId: etapaOrigemId,
        paraFunilEtapaId: destino.id,
      });
      return;
    }
    // 'tag' (rótulo escolhido) ou 'notificar' (rótulo de alerta) — idempotente.
    const nome = acao.tipo === 'tag' && acao.tagNome ? acao.tagNome : '⚠ SLA vencido';
    const tag = await this.prisma.tag.upsert({
      where: { empresaId_nome: { empresaId, nome } },
      create: { empresaId, nome, categoria: 'alerta' },
      update: {},
    });
    await this.prisma.leadTag.upsert({
      where: { leadId_tagId: { leadId, tagId: tag.id } },
      create: { leadId, tagId: tag.id, origem: 'ia' },
      update: {},
    });
  }

  // ─── Cron agendado (SPEC 1) ───────────────────────────────────────

  /**
   * Dispara fluxos com gatilho CRON_AGENDADO quando a expressão cron deles bate
   * a janela atual. Estado fica em `Fluxo.triggerConfig.proximoEm` (ISO): na 1ª
   * avaliação só agenda (não dispara); depois, quando `proximoEm <= agora`,
   * dispara e reagenda a partir de agora (não acumula atrasos). Latência máxima
   * = intervalo deste cron (30min) — pra "9h em ponto" cai entre 9:00 e 9:30.
   */
  private async avaliarCronAgendado(empresaId: string): Promise<void> {
    const flows = await this.prisma.fluxo.findMany({
      where: { empresaId, status: 'ATIVO', triggerTipo: 'CRON_AGENDADO' },
      select: {
        id: true,
        nome: true,
        triggerConfig: true,
        nos: { where: { tipo: 'TRIGGER' }, select: { id: true }, take: 1 },
      },
    });
    const agora = new Date();
    for (const f of flows) {
      const cfg = (f.triggerConfig ?? {}) as {
        expressao?: string;
        timezone?: string;
        proximoEm?: string;
      };
      const expr = (cfg.expressao ?? '').trim();
      if (!expr) continue;
      const tz = cfg.timezone || CRON_TZ_PADRAO;
      const proximo = cfg.proximoEm ? new Date(cfg.proximoEm) : null;

      // Primeira avaliação: só agenda o próximo (não dispara retroativo).
      if (!proximo || Number.isNaN(proximo.getTime())) {
        const prox = proximaExecucaoCron(expr, tz, agora);
        if (prox) await this.gravarProximoCron(f.id, cfg, prox);
        continue;
      }

      if (proximo.getTime() <= agora.getTime()) {
        const triggerNo = f.nos[0];
        if (triggerNo) {
          const exec = await this.prisma.fluxoExecucao.create({
            data: { fluxoId: f.id, empresaId, status: 'PENDENTE', contexto: { _cron: true } },
          });
          await this.bus.dispararDireto(exec.id, triggerNo.id);
          this.logger.log(`CRON_AGENDADO: fluxo "${f.nome}" disparado (exec ${exec.id})`);
        }
        const prox = proximaExecucaoCron(expr, tz, agora);
        if (prox) await this.gravarProximoCron(f.id, cfg, prox);
      }
    }
  }

  /** Persiste o próximo horário agendado no triggerConfig (preserva expressao/timezone). */
  private async gravarProximoCron(
    fluxoId: string,
    cfg: { expressao?: string; timezone?: string; proximoEm?: string },
    prox: Date,
  ): Promise<void> {
    await this.prisma.fluxo.update({
      where: { id: fluxoId },
      data: {
        triggerConfig: {
          ...cfg,
          proximoEm: prox.toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    });
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
        OR: [{ ultimoPedidoEm: { lt: corte } }, { ultimoPedidoEm: null }],
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
        cliente: {
          select: {
            id: true,
            nome: true,
            representanteId: true,
            representante: { select: { id: true, nome: true, email: true } },
          },
        },
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

      // E-mail transacional pro REP responsável (best-effort)
      if (amostra.cliente.representante?.email) {
        const diasDesdeEnvio = Math.max(
          1,
          Math.floor((agora.getTime() - amostra.enviadoEm.getTime()) / (1000 * 60 * 60 * 24)),
        );
        void this.email.enviarAmostraFollowup({
          para: amostra.cliente.representante.email,
          repNome: amostra.cliente.representante.nome,
          clienteNome: amostra.cliente.nome,
          produtoNome: amostra.produtoNome,
          diasDesdeEnvio,
        });
      }

      // Muda status pra evitar re-disparo
      await this.prisma.amostra.update({
        where: { id: amostra.id },
        data: { status: 'NAO_CONVERTEU' }, // status neutro de follow-up processado
      });
    }

    if (amostras.length > 0) {
      this.logger.log(`AMOSTRA_FOLLOWUP: ${amostras.length} amostra(s) em empresa ${empresaId}`);
    }
  }
}
