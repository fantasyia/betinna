import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import { ConversarIaService } from './conversar-ia.service';
import { CronMetricsService } from './cron-metrics.service';
import { proximaExecucaoCron, CRON_TZ_PADRAO } from './cron.util';

/**
 * FluxoTriggersJob — cron jobs que disparam fluxos com trigger baseado em tempo.
 *
 * Dois crons separados (latência diferente por necessidade):
 * - `avaliarTriggers` (a cada 30min): CLIENTE_INATIVO_30D, AMOSTRA_FOLLOWUP,
 *   SLA de etapas e timeouts de IA — nada disso precisa de precisão de minuto.
 * - `avaliarCronsAgendados` (a cada 1min): CRON_AGENDADO, que dispara em horário
 *   exato escolhido pelo usuário — latência alvo ≤ 1min (antes era ~30min).
 */
@Injectable()
export class FluxoTriggersJob {
  private readonly logger = new Logger(FluxoTriggersJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly bus: FluxoEventBusService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
    private readonly email: TransactionalEmailService,
    private readonly conversarIa: ConversarIaService,
    private readonly cronMetrics: CronMetricsService,
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
    }

    // Orquestração (Fase B) — conversas de IA sem resposta além do timeout
    // disparam LEAD_SEM_RESPOSTA e são encerradas (consulta global, todas empresas).
    await this.conversarIa.processarTimeouts();
  }

  /**
   * Avalia os fluxos CRON_AGENDADO a cada minuto — latência ≤ 1min (antes ~30min
   * quando ficava acoplado ao cron pesado de 30min). Query global única (todas as
   * empresas de uma vez), barata e indexada por (status, triggerTipo).
   */
  @Cron('* * * * *', { name: 'fluxo-cron-agendado', timeZone: 'UTC' })
  async avaliarCronsAgendados(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // TTL 50s — expira antes da próxima rodada de 1min (evita lock órfão travar).
    if (!(await this.cronLock.acquire('fluxo-cron-agendado', 50))) return;
    await this.avaliarCronAgendado();
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
   * a janela atual. O cursor do próximo disparo fica no REDIS (cron:next:<id>),
   * NÃO no triggerConfig (config do usuário): na 1ª avaliação só agenda (não
   * dispara); depois, quando `proximoEm <= agora`, dispara e reagenda a partir de
   * agora (não acumula atrasos). Roda a cada 1min → latência ≤ 1min.
   *
   * A cada disparo registra o atraso (agora − agendado) via CronMetricsService
   * pra alimentar os percentis do painel Admin.
   */
  private async avaliarCronAgendado(): Promise<void> {
    const flows = await this.prisma.fluxo.findMany({
      where: { status: 'ATIVO', triggerTipo: 'CRON_AGENDADO' },
      select: {
        id: true,
        nome: true,
        empresaId: true,
        triggerConfig: true,
        nos: { where: { tipo: 'TRIGGER' }, select: { id: true }, take: 1 },
      },
    });
    const agora = new Date();
    for (const f of flows) {
      const cfg = (f.triggerConfig ?? {}) as {
        expressao?: string;
        timezone?: string;
      };
      const expr = (cfg.expressao ?? '').trim();
      if (!expr) continue;
      const tz = cfg.timezone || CRON_TZ_PADRAO;
      // Cursor do próximo disparo no Redis (não no triggerConfig) — assim editar a
      // expressão não mexe no cursor e o cursor não sobrescreve a config do usuário.
      const proximoStr = await this.redis.get(`cron:next:${f.id}`);
      const proximo = proximoStr ? new Date(proximoStr) : null;

      // Primeira avaliação (sem cursor): só agenda o próximo (não dispara retroativo).
      if (!proximo || Number.isNaN(proximo.getTime())) {
        const prox = proximaExecucaoCron(expr, tz, agora);
        if (prox) await this.gravarProximoCron(f.id, prox);
        continue;
      }

      if (proximo.getTime() <= agora.getTime()) {
        const triggerNo = f.nos[0];
        if (triggerNo) {
          const exec = await this.prisma.fluxoExecucao.create({
            data: {
              fluxoId: f.id,
              empresaId: f.empresaId,
              status: 'PENDENTE',
              contexto: { _cron: true },
            },
          });
          await this.bus.dispararDireto(exec.id, triggerNo.id);
          // Métrica de latência: atraso entre o horário agendado e o disparo real.
          await this.cronMetrics.registrar(agora.getTime() - proximo.getTime());
          this.logger.log(`CRON_AGENDADO: fluxo "${f.nome}" disparado (exec ${exec.id})`);
        }
        const prox = proximaExecucaoCron(expr, tz, agora);
        if (prox) await this.gravarProximoCron(f.id, prox);
      }
    }
  }

  /**
   * Persiste o cursor do próximo disparo no Redis (cron:next:<fluxoId>), sem TTL.
   * Sobrescrito a cada disparo; chave órfã de fluxo apagado é inofensiva (nunca
   * mais é lida). Trade-off vs banco: um flush do Redis perde o cursor e o fluxo
   * reagenda (pula 1 disparo), auto-curando — aceitável p/ agendamento best-effort.
   */
  private async gravarProximoCron(fluxoId: string, prox: Date): Promise<void> {
    await this.redis.set(`cron:next:${fluxoId}`, prox.toISOString());
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
