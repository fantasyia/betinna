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
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { proximaExecucaoCrons, CRON_TZ_PADRAO } from './cron.util';
import { ehFeriadoNacional } from './feriados.util';

/**
 * FluxoTriggersJob — cron jobs que disparam fluxos com trigger baseado em tempo.
 *
 * Três crons separados (latência diferente por necessidade):
 * - `avaliarTriggers` (a cada 30min): CLIENTE_INATIVO_30D, AMOSTRA_FOLLOWUP e
 *   SLA de etapas — nada disso precisa de precisão de minuto.
 * - `avaliarCronsAgendados` (a cada 1min): CRON_AGENDADO, que dispara em horário
 *   exato escolhido pelo usuário — latência alvo ≤ 1min (antes era ~30min).
 * - `avaliarTimeoutsIa` (a cada 1min): timeout de conversa do CONVERSAR_IA. Saiu
 *   do cron de 30min porque o prazo configurado era arredondado pra cima até a
 *   próxima :00/:30 — um timeout de 5min virava até 30min (6x o prometido), em
 *   silêncio. Timeout longo (24h/72h) não notava; timeout curto é inviável assim.
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
    private readonly notificacoes: NotificacoesService,
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

    // Isolamento POR EMPRESA: sem o try/catch, uma exceção num tenant abortava a
    // rodada inteira e os tenants seguintes ficavam sem SLA/follow-up/inativos —
    // silenciosamente, porque o cron só roda de novo em 30min.
    for (const { id: empresaId } of empresas) {
      try {
        await this.avaliarClientesInativos(empresaId);
        await this.avaliarAmostrasFollowUp(empresaId);
        await this.avaliarSlaEtapas(empresaId);
      } catch (err) {
        this.logger.warn(
          `Triggers temporais falharam na empresa ${empresaId}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
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
    // ATENÇÃO: só é órfã se o job NÃO está mais na fila. Sob backlog do BullMQ
    // (worker atrasado), o deleteMany cego apagava execução cujo job ia rodar —
    // o passo então falhava com "execução não encontrada" e o disparo sumia.
    const candidatas = await this.prisma.fluxoExecucao.findMany({
      where: {
        status: 'PENDENTE',
        criadoEm: { lt: new Date(agora - 15 * 60 * 1000) },
        contexto: { path: ['_cron'], equals: true },
      },
      select: { id: true, jobId: true },
    });
    const idsOrfas: string[] = [];
    for (const c of candidatas) {
      if (!c.jobId) {
        // Execução antiga (criada antes de a gente gravar o jobId): mantém o
        // comportamento anterior — >15min PENDENTE é lixo.
        idsOrfas.push(c.id);
        continue;
      }
      const naFila = await this.bus.jobExiste(c.jobId).catch(() => true);
      if (!naFila) idsOrfas.push(c.id);
    }
    const cronOrfas = idsOrfas.length
      ? await this.prisma.fluxoExecucao.deleteMany({ where: { id: { in: idsOrfas } } })
      : { count: 0 };
    // Execuções ABANDONADAS (EM_EXECUCAO/PENDENTE sem job vivo).
    //
    // Achado real: a execução `cmsjoo6or…` estava EM_EXECUCAO desde 08/08 —
    // `terminouEm` null, `erroMsg` null, tentativas 0. Ninguém a reaproveita e
    // ninguém a mata: o `onFailed` do processor só marca FALHOU quando existe um
    // job que falhou. Se o job NUNCA chegou a existir (enqueue que se perdeu,
    // worker fora do ar na janela, jobId rejeitado pelo BullMQ), a execução fica
    // EM_EXECUCAO pra sempre — e o anti-reabertura do MENSAGEM_CANAL, que
    // considera PENDENTE/EM_EXECUCAO/AGUARDANDO como "já tem execução viva",
    // passa a BLOQUEAR aquela conversa em definitivo. Um lead que escreve nunca
    // mais dispara fluxo nenhum, sem erro em lugar nenhum.
    //
    // O critério NÃO pode ser só tempo: um nó DELAY de 3 dias mantém a execução
    // EM_EXECUCAO legitimamente. Por isso a pergunta é "tem job vivo na fila?" —
    // incluindo os delayed. Sem job vivo + parada há mais de 30min = abandonada.
    let abandonadas = 0;
    try {
      const vivos = await this.bus.execucoesComJobVivo();
      const paradas = await this.prisma.fluxoExecucao.findMany({
        where: {
          status: { in: ['PENDENTE', 'EM_EXECUCAO'] },
          // Não existe `atualizadoEm` nesta tabela; `criadoEm` basta como
          // pré-filtro barato — quem protege a espera longa é o job vivo.
          criadoEm: { lt: new Date(agora - 30 * 60 * 1000) },
        },
        select: { id: true },
        take: 200,
      });
      const mortas = paradas.map((e) => e.id).filter((id) => !vivos.has(id));
      if (mortas.length > 0) {
        const r = await this.prisma.fluxoExecucao.updateMany({
          where: { id: { in: mortas }, status: { in: ['PENDENTE', 'EM_EXECUCAO'] } },
          data: {
            status: 'FALHOU',
            terminouEm: new Date(),
            erroMsg:
              'Execução abandonada: nenhum job na fila e sem progresso há mais de 30min. ' +
              'Marcada como FALHOU pela reconciliação (senão travaria novas execuções da conversa).',
          },
        });
        abandonadas = r.count;
      }
    } catch (err) {
      // Fila inacessível: NÃO varre. Sem a lista de jobs vivos, todo delayed
      // legítimo viraria "abandonada" — o remédio seria pior que a doença.
      this.logger.warn(
        `Reconciliação: não deu pra checar jobs vivos (${err instanceof Error ? err.message : String(err)}) — varredura de abandonadas pulada.`,
      );
    }

    if (
      orfaos.count > 0 ||
      antigos.count > 0 ||
      lockOrfaos.count > 0 ||
      cronOrfas.count > 0 ||
      abandonadas > 0
    ) {
      this.logger.log(
        `Reconciliação: ${orfaos.count} claim(s) órfão(s) + ${antigos.count} antigo(s) removidos, ` +
          `${lockOrfaos.count} lock(s) destravado(s), ${cronOrfas.count} execução(ões) cron órfã(s), ` +
          `${abandonadas} execução(ões) abandonada(s) marcada(s) como FALHOU`,
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

  /**
   * Orquestração (Fase B) — conversas de IA sem resposta além do timeout disparam
   * LEAD_SEM_RESPOSTA e são encerradas (consulta global, todas as empresas).
   *
   * Cron PRÓPRIO de 1min: o `timeoutHoras` grava um `timeoutEm` exato e aceita
   * fração, mas quem detectava o vencimento era a varredura de 30min — o prazo
   * real virava "o configurado, arredondado até a próxima :00/:30". 24h não
   * notava; 5min virava até 30min. Agora a resolução é o minuto.
   *
   * A query é barata e indexada por (status, timeoutEm) — só execuções
   * AGUARDANDO com prazo vencido, com `take: 200` por rodada.
   */
  @Cron('* * * * *', { name: 'fluxo-timeouts-ia', timeZone: 'UTC' })
  async avaliarTimeoutsIa(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // TTL 50s, mesmo desenho do cron-agendado: expira antes da próxima rodada.
    if (!(await this.cronLock.acquire('fluxo-timeouts-ia', 50))) return;
    // try/catch próprio: falha aqui não pode derrubar os outros crons (e
    // vice-versa) — são responsabilidades independentes.
    try {
      await this.conversarIa.processarTimeouts();
    } catch (err) {
      this.logger.error(
        `processarTimeouts falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
      // Pra ações NÃO-destrutivas (tag/notificar) o lead continua na etapa depois
      // de processado — sem excluir quem já tem a tag, o mesmo lote de 100 era
      // reprocessado a cada 30min PRA SEMPRE e o lead 101 nunca era atendido.
      // (Em 'mover' o lead sai da etapa, então o próprio filtro já converge.)
      // MESMA regra do aplicarAcaoSla (senão o filtro procura outra tag e não
      // filtra nada): 'tag' com nome próprio usa o nome; o resto usa o padrão.
      const tagSla =
        acao.tipo === 'mover'
          ? null
          : acao.tipo === 'tag' && acao.tagNome
            ? acao.tagNome
            : '⚠ SLA vencido';
      const leads = await this.prisma.lead.findMany({
        where: {
          empresaId,
          funilEtapaId: etapa.id,
          etapaDesde: { lt: corte },
          ...(tagSla ? { tags: { none: { tag: { nome: tagSla, empresaId } } } } : {}),
        },
        select: { id: true },
        // Mais antigos primeiro: quem está esperando há mais tempo é atendido antes.
        orderBy: { etapaDesde: 'asc' },
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
    if (acao.tipo === 'mover') {
      // 'mover' NUNCA cai no ramo da etiqueta (auditoria 20/08): sem
      // etapaDestinoId ele carimbava '⚠ SLA vencido' — mas a busca do
      // avaliarSlaEtapas usa tagSla=null pro 'mover' (sem filtro de exclusão),
      // então os MESMOS 100 leads eram re-selecionados a cada rodada, cada uma
      // re-carimbando a tag, e os leads além dos 100 nunca eram processados.
      // Destino inválido idem: o return silencioso deixava o lote preso pra
      // sempre. Agora os dois casos LOGAM alto e saem — SLA mudo visível.
      if (!acao.etapaDestinoId) {
        this.logger.error(
          `SLA 'mover' da etapa ${etapaOrigemId} SEM etapaDestinoId — ação ignorada ` +
            '(configure o destino na etapa)',
        );
        return;
      }
      const destino = await this.prisma.funilEtapa.findFirst({
        where: { id: acao.etapaDestinoId, funil: { empresaId } },
        select: { id: true, funilId: true, tipo: true, capacidadeMaxima: true },
      });
      if (!destino) {
        this.logger.error(
          `SLA 'mover' da etapa ${etapaOrigemId}: destino ${acao.etapaDestinoId} não existe ` +
            'na empresa — ação ignorada (o lote desta etapa NÃO anda até consertar)',
        );
        return;
      }
      // Anti-sobrecarga também aqui (auditoria 20/08): o SLA 'mover' furava a
      // capacidadeMaxima do destino. Cheia → pula com log (job é batch; o lead
      // fica na etapa e a rodada seguinte tenta de novo quando abrir vaga).
      if (destino.capacidadeMaxima != null) {
        const ocupacao = await this.prisma.lead.count({
          where: { empresaId, funilEtapaId: destino.id },
        });
        if (ocupacao >= destino.capacidadeMaxima) {
          this.logger.warn(
            `SLA 'mover': destino ${destino.id} cheio (${ocupacao}/${destino.capacidadeMaxima}) — ` +
              `lead ${leadId} fica na etapa até abrir vaga`,
          );
          return;
        }
      }
      const etapaEnum =
        destino.tipo === 'GANHO' ? 'GANHO' : destino.tipo === 'PERDIDO' ? 'PERDIDO' : 'NOVO';
      await this.prisma.lead.update({
        where: { id: leadId },
        // `funilId` SINCRONIZADO junto (auditoria 20/08): destino de OUTRO funil
        // deixava o lead com funilEtapaId de um funil e funilId de outro — o
        // kanban mostra numa coluna e os filtros contam noutro funil. Mesmo
        // padrão do MOVER_LEAD_ETAPA no executor.
        data: {
          funilEtapaId: destino.id,
          funilId: destino.funilId,
          etapa: etapaEnum,
          etapaDesde: new Date(),
        },
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
    // AUDITORIA (média): a ação 'notificar' NÃO notificava ninguém — caía no
    // mesmo caminho da 'tag' e só carimbava uma etiqueta silenciosa. Quem
    // configurou "me avise quando estourar o SLA" nunca era avisado. Agora
    // notifica de verdade (in-app) ANTES de aplicar o rótulo, que continua
    // valendo como marcador visual no kanban.
    if (acao.tipo === 'notificar') {
      const lead = await this.prisma.lead
        .findUnique({
          where: { id: leadId },
          select: { nome: true, representanteId: true, funilEtapa: { select: { nome: true } } },
        })
        .catch(() => null);
      const nomeLead = lead?.nome ?? 'Lead';
      const etapa = lead?.funilEtapa?.nome ?? 'etapa atual';
      const params = {
        empresaId,
        tipo: 'LEAD_INATIVO' as const,
        titulo: 'SLA de etapa estourado',
        mensagem: `${nomeLead} passou do prazo em "${etapa}".`,
        link: `/kanban?lead=${leadId}`,
        metadata: { leadId, etapaOrigemId },
      };
      // Dono da carteira primeiro; sem rep atribuído, avisa a gerência.
      if (lead?.representanteId) {
        await this.notificacoes
          .criarParaUsuario({ ...params, usuarioId: lead.representanteId })
          .catch(() => null);
      } else {
        await this.notificacoes
          .criarParaRole({ ...params, roles: ['GERENTE', 'DIRECTOR'] })
          .catch(() => null);
      }
    }

    // 'tag' (rótulo escolhido) ou 'notificar' (rótulo de alerta) — idempotente.
    const nome = acao.tipo === 'tag' && acao.tagNome ? acao.tagNome : '⚠ SLA vencido';
    const tag = await this.prisma.tag.upsert({
      where: { empresaId_nome: { empresaId, nome } },
      create: { empresaId, nome, categoria: 'alerta' },
      update: {},
    });
    // createMany + skipDuplicates em vez de upsert porque aqui precisamos SABER
    // se a etiqueta é nova: `count` é 1 quando criou, 0 quando o lead já tinha.
    // O upsert não distingue os dois casos, e é essa distinção que decide se o
    // evento abaixo dispara.
    const { count: aplicou } = await this.prisma.leadTag.createMany({
      data: [{ leadId, tagId: tag.id, origem: 'ia' }],
      skipDuplicates: true,
    });

    // Aqui a função ACABAVA — gravava o LeadTag direto pelo prisma e pronto.
    // Quem dispara o evento é o LeadsService.vincularTag, e o job não passa por
    // lá: quem configurava "quando estourar o SLA, marca a etiqueta X" esperando
    // um fluxo reagir recebia SILÊNCIO. A etiqueta aparecia no kanban e nada
    // acontecia. É o irmão gêmeo do bug da ação 'notificar', consertado logo
    // acima nesta mesma função — mesma classe, mesma vítima.
    //
    // Com isto, cada etapa vira seu próprio gatilho de "lead parado", no prazo
    // que já está configurado nela: SLA + tagNome `parado:<etapa>` + um fluxo
    // com gatilho LEAD_RECEBEU_TAG em modo prefixo `parado:` pega todas.
    //
    // Dispara SÓ quando a etiqueta é nova (`aplicou`). Há duas defesas contra
    // repetição e as duas importam: a busca em avaliarSlaEtapas já exclui quem
    // tem a etiqueta, e esta confere no momento da escrita — o filtro sozinho
    // é uma corrida (duas rodadas do job concorrentes leem antes de escrever).
    // `tagNome` vai no payload porque é por ele que o gatilho filtra qual
    // etiqueta dispara o fluxo (match exato/prefixo).
    if (aplicou > 0) {
      await this.bus.disparar(empresaId, 'LEAD_RECEBEU_TAG', {
        leadId,
        tagId: tag.id,
        tagNome: nome,
      });
    }
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
      try {
        await this.avaliarCronDeUmFluxo(f, agora);
      } catch (err) {
        this.logger.error(
          `CRON_AGENDADO: fluxo "${f.nome}" (${f.id}) falhou nesta rodada: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Avalia UM fluxo CRON (extraído pra isolar falha por fluxo — ver acima). */
  private async avaliarCronDeUmFluxo(
    f: {
      id: string;
      nome: string;
      empresaId: string;
      triggerConfig: unknown;
      nos: Array<{ id: string }>;
    },
    agora: Date,
  ): Promise<void> {
    {
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
      if (exprs.length === 0) return;
      const tz = cfg.timezone || CRON_TZ_PADRAO;
      // Cursor do próximo disparo no Redis (não no triggerConfig) — assim editar a
      // expressão não mexe no cursor e o cursor não sobrescreve a config do usuário.
      const proximoStr = await this.redis.get(`cron:next:${f.id}`);
      const proximo = proximoStr ? new Date(proximoStr) : null;

      // Primeira avaliação (sem cursor): só agenda o próximo (não dispara retroativo).
      if (!proximo || Number.isNaN(proximo.getTime())) {
        const prox = proximaExecucaoCrons(exprs, tz, agora);
        if (prox) await this.gravarProximoCron(f.id, prox);
        return;
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
          // jobId gravado JUNTO: o reaper de execuções PENDENTE precisa dele pra
          // distinguir "job nunca existiu" (órfã) de "job ainda na fila"
          // (backlog) — sem isso ele apagava execução que ia rodar.
          const jobIdCron = `cron_${f.id}_${slot.getTime()}`;
          // AUDITORIA (média): o cursor já foi gravado ACIMA (claim, pra evitar
          // disparo duplicado). Se o create/enfileiramento falhar aqui, o slot
          // está perdido PRA SEMPRE — o cron das 09:00 simplesmente não roda
          // naquele dia por causa de um erro transiente. A compensação devolve o
          // cursor pro próprio slot, e a rodada seguinte (1min depois) tenta de
          // novo; o jobId determinístico por slot garante que, se o disparo
          // tiver ido, o BullMQ deduplica em vez de rodar duas vezes.
          let exec;
          try {
            exec = await this.prisma.fluxoExecucao.create({
              data: {
                fluxoId: f.id,
                empresaId: f.empresaId,
                status: 'PENDENTE',
                contexto: { _cron: true },
                jobId: jobIdCron,
              },
            });
          } catch (err) {
            await this.gravarProximoCron(f.id, slot).catch(() => undefined);
            this.logger.error(
              `Cron do fluxo ${f.id}: falha ao criar execução do slot ${slot.toISOString()} — ` +
                `cursor devolvido pra retentar. Causa: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
          }
          // jobId determinístico por slot → reforço: BullMQ deduplica enfileiramento
          // duplicado se duas rodadas correrem o mesmo slot antes do claim do cursor.
          // SEM ":" — o BullMQ (v5) REJEITA custom job id com ":" ("Custom Id cannot
          // contain :"), o que fazia o queue.add lançar e a execução ficar PENDENTE pra
          // sempre. Usa epoch (getTime) do slot no lugar do ISO (que tinha ":").
          try {
            await this.bus.dispararDireto(exec.id, triggerNo.id, { jobId: jobIdCron });
          } catch (err) {
            // Execução criada mas não enfileirada: devolve o cursor E marca a
            // execução como falha, senão ela fica PENDENTE órfã pra sempre.
            await this.gravarProximoCron(f.id, slot).catch(() => undefined);
            await this.prisma.fluxoExecucao
              .update({
                where: { id: exec.id },
                data: { status: 'FALHOU', erroMsg: 'falha ao enfileirar o job do cron' },
              })
              .catch(() => undefined);
            this.logger.error(
              `Cron do fluxo ${f.id}: falha ao ENFILEIRAR o slot ${slot.toISOString()} — ` +
                `cursor devolvido. Causa: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
          }
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
    // CAÇADA-BUG #37 (revisão): `bus.disparar` aciona TODOS os fluxos ativos deste trigger. Antes o
    // `diasInativo` vinha do MENOR entre os fluxos e ia igual pra todos → um cliente de 35 dias recebia
    // TAMBÉM a régua do fluxo de 90 dias (audiência errada). Agora: o job seleciona no MENOR limiar
    // (garante que nenhum cliente-alvo é perdido) e passa a inatividade REAL de cada cliente no
    // contexto (`diasSemPedido`); o `FluxoEventBus` FILTRA por fluxo, disparando só quem cruzou o
    // `diasInativo` DAQUELE fluxo. Cooldown segue por-cliente (anti-spam da rodada).
    // FONTE DO `diasInativo`: o editor grava no CONFIG DO NÓ de gatilho, e é de
    // lá que o FluxoEventBus filtra. O job lia só o `Fluxo.triggerConfig` e caía
    // no default 30 — então um fluxo configurado pra 15 dias nunca selecionava
    // clientes entre 15 e 30 dias e simplesmente não disparava. Lê os dois,
    // com precedência pro nó (mesma fonte do filtro).
    const fluxos = await this.prisma.fluxo.findMany({
      where: { empresaId, status: 'ATIVO', triggerTipo: 'CLIENTE_INATIVO_30D' },
      select: {
        triggerConfig: true,
        nos: { where: { tipo: 'TRIGGER' }, select: { config: true }, take: 1 },
      },
    });
    if (fluxos.length === 0) return;
    const diasPorFluxo = fluxos.map((f) => {
      const doNo = (f.nos[0]?.config as Record<string, unknown> | null)?.['diasInativo'];
      const doFluxo = (f.triggerConfig as Record<string, unknown> | null)?.['diasInativo'];
      const bruto = Number(doNo ?? doFluxo ?? 30);
      return Number.isFinite(bruto) && bruto > 0 ? bruto : 30;
    });
    const diasInativo = Math.min(...diasPorFluxo);

    const agora = Date.now();
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
      select: { id: true, nome: true, representanteId: true, ultimoPedidoEm: true },
      // Ordem determinística + nunca-disparado primeiro: sem orderBy, o take:50 repetia
      // o mesmo prefixo e quem estava além de 50 nunca disparava.
      orderBy: [{ reativacaoDisparadaEm: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: 50, // lote máximo por rodada pra não sobrecarregar
    });

    if (clientesInativos.length === 0) return;

    const MS_DIA = 86_400_000;
    for (const cliente of clientesInativos) {
      // Inatividade REAL do cliente: sem pedido nunca → muito alto (passa em qualquer limiar de fluxo).
      const diasSemPedido = cliente.ultimoPedidoEm
        ? Math.floor((agora - cliente.ultimoPedidoEm.getTime()) / MS_DIA)
        : Number.MAX_SAFE_INTEGER;
      // AUDITORIA (média): o cooldown era UM só, com o MENOR limiar entre os
      // fluxos. Cliente parado 150 dias com réguas de 30 e 90 recebia a de 90
      // A CADA 30 DIAS, indefinidamente — o `reativacaoDisparadaEm` liberava
      // pelo corte de 30, e o filtro do bus deixava passar (150 >= 90).
      //
      // Agora o cooldown é POR LIMIAR, com TTL igual ao próprio limiar: quem
      // recebeu a régua de 90 só volta a recebê-la daqui a 90 dias. Redis em vez
      // de coluna nova porque expira sozinho e não precisa de migration.
      const cruzados = [...new Set(diasPorFluxo)].filter((d) => diasSemPedido >= d);
      const liberados: number[] = [];
      for (const d of cruzados) {
        const chave = `reativ:${empresaId}:${cliente.id}:${d}`;
        const primeiro = await this.redis.setNxEx(chave, '1', d * 86_400).catch(() => true);
        if (primeiro) liberados.push(d);
      }
      // Todos os limiares que este cliente cruza já dispararam dentro da janela.
      if (liberados.length === 0) continue;

      await this.bus.disparar(empresaId, 'CLIENTE_INATIVO_30D', {
        clienteId: cliente.id,
        cliente: { id: cliente.id, nome: cliente.nome },
        representanteId: cliente.representanteId,
        diasSemPedido,
        // O bus filtra por fluxo: só dispara o fluxo cujo limiar está liberado.
        limiaresLiberados: liberados,
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
