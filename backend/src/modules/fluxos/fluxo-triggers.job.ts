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
import { proximaExecucaoCrons, CRON_TZ_PADRAO } from './cron.util';
import { ehFeriadoNacional } from './feriados.util';

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
   * Reconciliação dos claims de idempotência do executor (FluxoStepClaim).
   *
   * - EXECUTANDO órfão > 15min: o worker morreu entre o efeito e a marca CONCLUIDO e o
   *   BullMQ já deu o job como falho-final (dead-letter) → esse claim nunca mais será
   *   re-tentado. 15min > (attempts:3 × backoff exponencial de poucos segundos), então
   *   nenhum retry vivo ainda o usa — pode remover com segurança.
   * - CONCLUIDO > 7 dias: housekeeping pra a tabela não crescer indefinidamente
   *   (1 linha por passo executado); não é crítico.
   */
  @Cron('*/15 * * * *', { name: 'fluxo-step-claim-reconcile', timeZone: 'UTC' })
  async reconciliarClaims(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('fluxo-step-claim-reconcile', 14 * 60))) return;

    const agora = Date.now();
    const orfaos = await this.prisma.fluxoStepClaim.deleteMany({
      where: { estado: 'EXECUTANDO', criadoEm: { lt: new Date(agora - 15 * 60 * 1000) } },
    });
    const antigos = await this.prisma.fluxoStepClaim.deleteMany({
      where: { estado: 'CONCLUIDO', criadoEm: { lt: new Date(agora - 7 * 24 * 60 * 60 * 1000) } },
    });
    // Destrava o lock de turno órfão: se o worker morreu no meio do retomar (sem rodar o
    // finally), processandoTurno fica preso em true e o bot nunca mais responde o lead.
    // Turno de IA é curto (segundos), então 15min sem progresso = órfão seguro de resetar.
    const lockOrfaos = await this.prisma.fluxoExecucao.updateMany({
      where: {
        status: 'AGUARDANDO',
        processandoTurno: true,
        // turnoIniciadoEm (início do TURNO), não iniciouEm (início da execução): senão uma
        // conversa saudável de 24h teria iniciouEm sempre >15min atrás e o reaper resetaria
        // o lock no meio de um turno legítimo → turno em dobro (custo + classificou 2×).
        turnoIniciadoEm: { lt: new Date(agora - 15 * 60 * 1000) },
      },
      data: { processandoTurno: false },
    });
    // Órfãs PENDENTE do cron: o CRON_AGENDADO cria a execução ANTES do dedup por jobId;
    // numa rodada sobreposta o job é deduplicado e a execução fica PENDENTE pra sempre.
    // PENDENTE de cron com >15min (job nunca rodou) é lixo seguro de remover.
    const cronOrfas = await this.prisma.fluxoExecucao.deleteMany({
      where: {
        status: 'PENDENTE',
        criadoEm: { lt: new Date(agora - 15 * 60 * 1000) },
        contexto: { path: ['_cron'], equals: true },
      },
    });
    if (orfaos.count > 0 || antigos.count > 0 || lockOrfaos.count > 0 || cronOrfas.count > 0) {
      this.logger.log(
        `Reconciliação: ${orfaos.count} claim(s) órfão(s) + ${antigos.count} antigo(s) removidos, ` +
          `${lockOrfaos.count} lock(s) destravado(s), ${cronOrfas.count} execução(ões) cron órfã(s)`,
      );
    }
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
        expressoes?: string[];
        timezone?: string;
        pularFeriados?: boolean;
      };
      // `expressoes` (múltiplos horários/regras) tem precedência; fallback p/ o
      // `expressao` legado de fluxos salvos antes do suporte a múltiplas regras.
      const exprs = (cfg.expressoes?.length ? cfg.expressoes : cfg.expressao ? [cfg.expressao] : [])
        .map((e) => (e ?? '').trim())
        .filter(Boolean);
      if (exprs.length === 0) continue;
      const tz = cfg.timezone || CRON_TZ_PADRAO;
      // Cursor do próximo disparo no Redis (não no triggerConfig) — assim editar a
      // expressão não mexe no cursor e o cursor não sobrescreve a config do usuário.
      const proximoStr = await this.redis.get(`cron:next:${f.id}`);
      const proximo = proximoStr ? new Date(proximoStr) : null;

      // Primeira avaliação (sem cursor): só agenda o próximo (não dispara retroativo).
      if (!proximo || Number.isNaN(proximo.getTime())) {
        const prox = proximaExecucaoCrons(exprs, tz, agora);
        if (prox) await this.gravarProximoCron(f.id, prox);
        continue;
      }

      if (proximo.getTime() <= agora.getTime()) {
        const slot = proximo; // snapshot do horário agendado antes de avançar o cursor
        // CLAIM do slot: avança o cursor ANTES de disparar. Uma rodada sobreposta (lock
        // de 50s expirado numa rodada lenta) lê `proximo > agora` e pula → sem disparo
        // duplicado. O avanço deixou de acontecer só DEPOIS do disparo (janela do bug).
        const prox = proximaExecucaoCrons(exprs, tz, agora);
        if (prox) {
          await this.gravarProximoCron(f.id, prox);
        } else {
          // Expressão sem próxima execução em runtime (drift do parser / dado corrompido):
          // sem avançar, o cursor fica <= agora e re-dispara TODO minuto (1 execução/min).
          // Avança 1min e loga, em vez de entrar em loop.
          await this.gravarProximoCron(f.id, new Date(agora.getTime() + 60_000));
          this.logger.warn(
            `Cron do fluxo ${f.id}: expressão sem próxima execução — cursor avançado 1min.`,
          );
        }

        // Opção "pular feriados": no feriado nacional, NÃO dispara (cursor já avançou).
        const noFeriado = cfg.pularFeriados === true && ehFeriadoNacional(slot, tz);
        const triggerNo = f.nos[0];
        if (triggerNo && !noFeriado) {
          const exec = await this.prisma.fluxoExecucao.create({
            data: {
              fluxoId: f.id,
              empresaId: f.empresaId,
              status: 'PENDENTE',
              contexto: { _cron: true },
            },
          });
          // jobId determinístico por slot → reforço: BullMQ deduplica enfileiramento
          // duplicado se duas rodadas correrem o mesmo slot antes do claim do cursor.
          await this.bus.dispararDireto(exec.id, triggerNo.id, {
            jobId: `cron:${f.id}:${slot.toISOString()}`,
          });
          // Métrica de latência: atraso entre o horário agendado e o disparo real.
          await this.cronMetrics.registrar(agora.getTime() - slot.getTime());
          this.logger.log(`CRON_AGENDADO: fluxo "${f.nome}" disparado (exec ${exec.id})`);
        } else if (noFeriado) {
          this.logger.log(`CRON_AGENDADO: fluxo "${f.nome}" pulado (feriado nacional)`);
        }
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
    // CAÇADA-BUG #37: `bus.disparar` aciona TODOS os fluxos ativos deste trigger, mas antes o
    // `diasInativo` vinha só do PRIMEIRO (findFirst) — se ele fosse 90, os clientes de um fluxo de 30
    // dias NUNCA eram selecionados. Usa o MENOR diasInativo entre todos → nenhum cliente-alvo é
    // perdido. ⚠️ Limitação: o cooldown é 1 campo só (`Cliente.reativacaoDisparadaEm`), então um fluxo
    // de janela MAIOR dispara junto no limiar menor — logamos aviso quando as janelas divergem.
    const fluxos = await this.prisma.fluxo.findMany({
      where: { empresaId, status: 'ATIVO', triggerTipo: 'CLIENTE_INATIVO_30D' },
      select: { triggerConfig: true },
    });
    if (fluxos.length === 0) return;
    const diasPorFluxo = fluxos.map((f) =>
      Number((f.triggerConfig as Record<string, unknown> | null)?.['diasInativo'] ?? 30),
    );
    const diasInativo = Math.min(...diasPorFluxo);
    if (new Set(diasPorFluxo).size > 1) {
      this.logger.warn(
        `Empresa ${empresaId}: ${fluxos.length} fluxos CLIENTE_INATIVO_30D com diasInativo diferentes ` +
          `(${[...new Set(diasPorFluxo)].sort((a, b) => a - b).join(', ')}) — usando o menor (${diasInativo}); ` +
          `todos disparam nesse limiar (cooldown é por-cliente, não por-fluxo).`,
      );
    }

    const corte = new Date();
    corte.setDate(corte.getDate() - diasInativo);

    const clientesInativos = await this.prisma.cliente.findMany({
      where: {
        empresaId,
        status: { not: 'INATIVO' },
        OR: [{ ultimoPedidoEm: { lt: corte } }, { ultimoPedidoEm: null }],
        // Anti-spam: não re-dispara quem já foi disparado dentro da janela de
        // inatividade. Sem isto o gatilho re-disparava os MESMOS clientes a cada 30min.
        AND: [
          {
            OR: [{ reativacaoDisparadaEm: null }, { reativacaoDisparadaEm: { lt: corte } }],
          },
        ],
      },
      select: { id: true, nome: true, representanteId: true },
      // Ordem determinística + nunca-disparado primeiro: sem orderBy, o take:50 repetia
      // o mesmo prefixo e quem estava além de 50 nunca disparava.
      orderBy: [{ reativacaoDisparadaEm: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: 50, // lote máximo por rodada pra não sobrecarregar
    });

    if (clientesInativos.length === 0) return;

    for (const cliente of clientesInativos) {
      await this.bus.disparar(empresaId, 'CLIENTE_INATIVO_30D', {
        clienteId: cliente.id,
        cliente: { id: cliente.id, nome: cliente.nome },
        representanteId: cliente.representanteId,
        diasSemPedido: diasInativo,
      });
    }

    // Marca os disparados pra não re-disparar na próxima rodada (cooldown = janela).
    await this.prisma.cliente.updateMany({
      where: { id: { in: clientesInativos.map((c) => c.id) }, empresaId },
      data: { reativacaoDisparadaEm: new Date() },
    });

    this.logger.log(
      `CLIENTE_INATIVO_30D: ${clientesInativos.length} cliente(s) em empresa ${empresaId}`,
    );
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
      // CAS: reivindica o follow-up ANTES de disparar/notificar. Se o processo cair entre o
      // disparo e o update de status, a amostra continuava AGUARDANDO_FOLLOWUP e re-disparava
      // (evento + e-mail ao rep em dobro). Agora só segue quem reivindicou.
      const claim = await this.prisma.amostra.updateMany({
        where: { id: amostra.id, status: 'AGUARDANDO_FOLLOWUP' },
        data: { status: 'NAO_CONVERTEU' }, // status neutro de follow-up processado
      });
      if (claim.count === 0) continue;

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
    }

    if (amostras.length > 0) {
      this.logger.log(`AMOSTRA_FOLLOWUP: ${amostras.length} amostra(s) em empresa ${empresaId}`);
    }
  }
}
