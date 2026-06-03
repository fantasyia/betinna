import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { FluxoNo, FluxoEdge } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { HttpClientService } from '@shared/http/http-client.service';
import { WhatsAppService } from '@integrations/whatsapp/whatsapp.service';
import { ResendService } from '@integrations/resend/resend.service';
import { Prisma } from '@prisma/client';
import { safeRequest, SsrfBlockedError } from '@shared/utils/safe-request';
import { ConversarIaService } from './conversar-ia.service';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import {
  FLUXO_QUEUE,
  type FluxoStepJobData,
  type DelayConfig,
  type CondicaoConfig,
  type EnviarWhatsappConfig,
  type EnviarEmailConfig,
  type CriarTarefaConfig,
  type MudarTagConfig,
  type MoverLeadEtapaConfig,
  type AtribuirRepConfig,
  type WebhookExternoConfig,
  type LiberarLoteConfig,
  type ExecucaoContexto,
} from './fluxo-executor.types';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Interpola variáveis no formato {{caminho.ponto}} dentro de strings.
 * Exemplo: "Olá {{cliente.nome}}!" com { cliente: { nome: "João" } } → "Olá João!"
 */
export function interpolate(template: string, ctx: ExecucaoContexto): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, key: string) => {
    const parts = key.split('.');
    let val: unknown = ctx;
    for (const part of parts) {
      if (val == null || typeof val !== 'object') return match;
      val = (val as Record<string, unknown>)[part];
    }
    return val != null ? String(val) : match;
  });
}

/** Resolve um campo pontilhado do contexto: "cliente.nome" → ctx.cliente.nome */
function resolveField(campo: string, ctx: ExecucaoContexto): unknown {
  return campo.split('.').reduce((acc: unknown, part) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, ctx as unknown);
}

/** Interpola recursivamente todas as strings dentro de um objeto/array. */
function interpolateDeep(obj: unknown, ctx: ExecucaoContexto): unknown {
  if (typeof obj === 'string') return interpolate(obj, ctx);
  if (Array.isArray(obj)) return obj.map((item) => interpolateDeep(item, ctx));
  if (obj != null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, interpolateDeep(v, ctx)]),
    );
  }
  return obj;
}

/** Cast seguro de Record<string, unknown> para Prisma InputJsonObject. */
const toJsonInput = (v: Record<string, unknown>): Prisma.InputJsonObject =>
  v as unknown as Prisma.InputJsonObject;

/** Converte unidade de delay para milissegundos. */
function delayParaMs(valor: number, unidade: DelayConfig['unidade']): number {
  const mult = { minutos: 60_000, horas: 3_600_000, dias: 86_400_000 };
  return valor * mult[unidade];
}

/** Avalia uma condição do nó CONDICAO. Retorna "true" ou "false" (string). */
function avaliarCondicao(config: CondicaoConfig, ctx: ExecucaoContexto): 'true' | 'false' {
  const val = resolveField(config.campo, ctx);
  const ref = config.valor;
  let resultado: boolean;
  switch (config.operador) {
    case 'eq':
      resultado = val == ref;
      break;
    case 'neq':
      resultado = val != ref;
      break;
    case 'gt':
      resultado = Number(val) > Number(ref);
      break;
    case 'lt':
      resultado = Number(val) < Number(ref);
      break;
    case 'gte':
      resultado = Number(val) >= Number(ref);
      break;
    case 'lte':
      resultado = Number(val) <= Number(ref);
      break;
    case 'contains':
      resultado = String(val).includes(String(ref));
      break;
    default:
      resultado = false;
  }
  return resultado ? 'true' : 'false';
}

// ─── Serviço ──────────────────────────────────────────────────────────

/**
 * FluxoExecutorService — motor de execução passo-a-passo.
 *
 * Responsável por:
 * 1. Carregar o estado atual da execução + grafo do fluxo.
 * 2. Executar o nó indicado pelo job.
 * 3. Logar o resultado.
 * 4. Enfileirar o(s) próximo(s) nó(s), com delay quando necessário.
 * 5. Marcar a execução como CONCLUIDO ou FALHOU.
 */
@Injectable()
export class FluxoExecutorService {
  private readonly logger = new Logger(FluxoExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly http: HttpClientService,
    private readonly whatsapp: WhatsAppService,
    private readonly resend: ResendService,
    private readonly conversarIa: ConversarIaService,
    private readonly bus: FluxoEventBusService,
    @InjectQueue(FLUXO_QUEUE) private readonly queue: Queue<FluxoStepJobData>,
  ) {}

  /**
   * Executa um passo da execução (chamado pelo BullMQ Processor).
   */
  async executarPasso(execucaoId: string, noId: string): Promise<void> {
    // Carrega execução
    const execucao = await this.prisma.fluxoExecucao.findUnique({
      where: { id: execucaoId },
    });
    if (!execucao) {
      this.logger.warn(`Execução ${execucaoId} não encontrada — passo ignorado`);
      return;
    }
    // Defesa em profundidade: nenhuma execução roda sem empresaId.
    // Auditoria 2026-05-15 — sem isso, ações faziam writes cross-tenant.
    if (!execucao.empresaId) {
      this.logger.error(`Execução ${execucaoId} sem empresaId — fluxo malformado, abortando`);
      await this.marcarFalhou(execucaoId, 'empresaId ausente na execução — fluxo inválido');
      return;
    }
    if (execucao.status === 'CANCELADO') {
      this.logger.debug(`Execução ${execucaoId} cancelada — passo ignorado`);
      return;
    }

    // Atualiza status pra EM_EXECUCAO na primeira vez
    if (execucao.status === 'PENDENTE') {
      await this.prisma.fluxoExecucao.update({
        where: { id: execucaoId },
        data: { status: 'EM_EXECUCAO', iniciouEm: new Date() },
      });
    }

    // Carrega nó + grafo
    const [no, arestas] = await Promise.all([
      this.prisma.fluxoNo.findUnique({ where: { id: noId } }),
      this.prisma.fluxoEdge.findMany({ where: { fluxoId: execucao.fluxoId } }),
    ]);

    if (!no) {
      await this.marcarFalhou(execucaoId, `Nó ${noId} não encontrado no fluxo`);
      return;
    }

    const contexto = await this.enriquecerContexto(
      execucao.contexto as ExecucaoContexto,
      execucao.empresaId,
    );
    const iniciadoEm = new Date();
    let output: Record<string, unknown> | null = null;
    let erroMsg: string | null = null;
    let sucesso = true;
    // Quando o nó "Conversar com IA" envia a 1ª msg e fica esperando o lead,
    // a execução pausa (status AGUARDANDO) e NÃO avança aqui — retoma em LEAD_RESPONDEU.
    let aguardando = false;

    try {
      if (no.tipo === 'ACAO' && no.acaoTipo === 'CONVERSAR_IA') {
        const r = await this.conversarIa.iniciar(execucaoId, no, contexto, execucao.empresaId);
        aguardando = r.aguardando;
        output = { conversarIa: true, aguardando };
      } else {
        output = await this.executarNo(no, contexto, execucao.empresaId);
      }
    } catch (err) {
      sucesso = false;
      erroMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Fluxo ${execucao.fluxoId} / exec ${execucaoId} / nó ${no.titulo}: ${erroMsg}`,
      );
    }

    // Registra log do passo
    const logStatus = sucesso ? ('CONCLUIDO' as const) : ('FALHOU' as const);
    await this.prisma.fluxoExecucaoLog.create({
      data: {
        execucaoId,
        noId,
        noTitulo: no.titulo,
        status: logStatus,
        input: toJsonInput(contexto),
        output: output ? toJsonInput(output) : Prisma.JsonNull,
        erroMsg: erroMsg ?? undefined,
        iniciadoEm,
        terminadoEm: new Date(),
      },
    });

    if (!sucesso) {
      // Nó falhou — lança para o BullMQ re-tentar
      throw new Error(`Nó "${no.titulo}" falhou: ${erroMsg}`);
    }

    // Nó "Conversar com IA" esperando resposta do lead: pausa aqui (a retomada
    // acontece em LEAD_RESPONDEU, via ConversarIaService.retomar).
    if (aguardando) {
      this.logger.debug(`Execução ${execucaoId} pausada (Conversar com IA aguardando lead)`);
      return;
    }

    // Determina próximos nós
    const labelParaNavegar =
      no.tipo === 'CONDICAO'
        ? avaliarCondicao(no.config as unknown as CondicaoConfig, contexto)
        : null;

    const proximosNoIds = arestas
      .filter((e: FluxoEdge) => e.sourceNoId === noId)
      .filter((e: FluxoEdge) => labelParaNavegar === null || e.label === labelParaNavegar)
      .map((e: FluxoEdge) => e.targetNoId);

    if (proximosNoIds.length === 0) {
      // Fim do caminho — marca execução como CONCLUIDO
      await this.prisma.fluxoExecucao.update({
        where: { id: execucaoId },
        data: { status: 'CONCLUIDO', terminouEm: new Date() },
      });
      this.logger.log(`Execução ${execucaoId} concluída`);
      return;
    }

    // Enfileira próximos passos
    for (const nextNoId of proximosNoIds) {
      let delayMs = 0;
      // DELAY: agenda próximo passo com delay
      if (no.tipo === 'DELAY') {
        const cfg = no.config as unknown as DelayConfig;
        delayMs = delayParaMs(cfg.valor ?? 1, cfg.unidade ?? 'horas');
      }
      await this.queue.add(
        'step',
        { execucaoId, noId: nextNoId },
        {
          delay: delayMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 200 },
        },
      );
    }
  }

  // ─── Variáveis com escopo (orquestração Fase A) ─────────────────────

  /**
   * Enriquece o contexto de interpolação com os namespaces {{sistema.*}} e
   * {{custom.*}} antes de cada nó. `sistema` traz data/empresa; `custom` traz
   * as variáveis flexíveis do lead (gravadas por IA/fluxos — Lead.variaveis).
   * Recarregado por nó: reflete variáveis gravadas no meio do fluxo.
   */
  private async enriquecerContexto(
    contexto: ExecucaoContexto,
    empresaId: string,
  ): Promise<ExecucaoContexto> {
    const ctx: Record<string, unknown> = { ...(contexto as Record<string, unknown>) };

    const agora = new Date();
    const dd = String(agora.getDate()).padStart(2, '0');
    const mm = String(agora.getMonth() + 1).padStart(2, '0');
    const yyyy = agora.getFullYear();
    const hh = String(agora.getHours()).padStart(2, '0');
    const min = String(agora.getMinutes()).padStart(2, '0');
    // Lookups são best-effort: o enriquecimento é auxiliar e NUNCA derruba o fluxo.
    let empresaNome = '';
    try {
      const empresa = await this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { nome: true },
      });
      empresaNome = empresa?.nome ?? '';
    } catch {
      /* ignora — {{sistema.empresa_nome}} fica vazio */
    }
    ctx.sistema = {
      empresa_nome: empresaNome,
      data_hoje: `${dd}/${mm}/${yyyy}`,
      data_hora: `${dd}/${mm}/${yyyy} ${hh}:${min}`,
    };

    // {{custom.*}} — variáveis flexíveis do lead (se houver lead no contexto).
    const leadId = typeof ctx.leadId === 'string' ? ctx.leadId : undefined;
    if (leadId) {
      try {
        const lead = await this.prisma.lead.findFirst({
          where: { id: leadId, empresaId },
          select: { variaveis: true },
        });
        if (lead?.variaveis && typeof lead.variaveis === 'object') {
          ctx.custom = lead.variaveis;
        }
      } catch {
        /* ignora — {{custom.*}} fica vazio */
      }
    }
    if (ctx.custom == null) ctx.custom = {};

    return ctx;
  }

  // ─── Executor de nó ─────────────────────────────────────────────────

  private async executarNo(
    no: FluxoNo,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    switch (no.tipo) {
      case 'TRIGGER':
        return { triggered: true };

      case 'DELAY':
        // DELAY é tratado pelo enfileiramento com delay — nada a executar aqui
        return { delayed: true };

      case 'CONDICAO': {
        const cfg = no.config as unknown as CondicaoConfig;
        const resultado = avaliarCondicao(cfg, ctx);
        return { resultado };
      }

      case 'ACAO':
        return this.executarAcao(no, ctx, empresaId);

      default:
        return {};
    }
  }

  private async executarAcao(
    no: FluxoNo,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    const acaoTipo = no.acaoTipo;
    if (!acaoTipo) throw new Error(`Nó ACAO sem acaoTipo definido`);

    const cfg = no.config as unknown;
    switch (acaoTipo) {
      case 'ENVIAR_WHATSAPP':
        return this.acaoEnviarWhatsapp(cfg as EnviarWhatsappConfig, ctx, empresaId);

      case 'ENVIAR_EMAIL':
        return this.acaoEnviarEmail(cfg as EnviarEmailConfig, ctx, empresaId);

      case 'CRIAR_TAREFA':
        return this.acaoCriarTarefa(cfg as CriarTarefaConfig, ctx, empresaId);

      case 'MUDAR_TAG':
        return this.acaoMudarTag(cfg as MudarTagConfig, ctx, empresaId);

      case 'MOVER_LEAD_ETAPA':
        return this.acaoMoverLeadEtapa(cfg as MoverLeadEtapaConfig, ctx, empresaId);

      case 'ATRIBUIR_REP':
        return this.acaoAtribuirRep(cfg as AtribuirRepConfig, ctx, empresaId);

      case 'WEBHOOK_EXTERNO':
        return this.acaoWebhookExterno(cfg as WebhookExternoConfig, ctx);

      case 'LIBERAR_LOTE':
        return this.acaoLiberarLote(cfg as LiberarLoteConfig, empresaId);

      default:
        throw new Error(`Tipo de ação desconhecido: ${acaoTipo}`);
    }
  }

  // ─── Ações concretas ────────────────────────────────────────────────

  private async acaoEnviarWhatsapp(
    cfg: EnviarWhatsappConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'ENVIAR_WHATSAPP');
    // Resolve telefone do cliente — exige que o cliente PERTENÇA à empresa
    const clienteId = ctx['clienteId'] as string | undefined;
    if (!clienteId) throw new Error('contexto.clienteId ausente para ENVIAR_WHATSAPP');

    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      select: { telefone: true, nome: true },
    });
    if (!cliente) {
      throw new Error(`Cliente ${clienteId} não encontrado na empresa ${empresaId}`);
    }
    if (!cliente.telefone) throw new Error(`Cliente ${clienteId} sem telefone cadastrado`);

    const mensagem = interpolate(cfg.mensagem, ctx);

    // Normaliza telefone para JID WhatsApp
    const telefone = cliente.telefone.replace(/\D/g, '');
    const peerId = `${telefone}@s.whatsapp.net`;

    const result = await this.whatsapp.enviarTexto(empresaId, peerId, mensagem, {});
    return { peerId, mensagem, externalId: result.externalId };
  }

  private async acaoEnviarEmail(
    cfg: EnviarEmailConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'ENVIAR_EMAIL');
    // Resolve e-mail do destinatário
    let email = cfg.destinatario;
    if (!email) {
      const clienteId = ctx['clienteId'] as string | undefined;
      if (clienteId) {
        const cliente = await this.prisma.cliente.findFirst({
          where: { id: clienteId, empresaId },
          select: { email: true, nome: true },
        });
        if (!cliente) {
          throw new Error(`Cliente ${clienteId} não encontrado na empresa ${empresaId}`);
        }
        email = cliente.email ?? undefined;
      }
    }
    if (!email) throw new Error('E-mail do destinatário não resolvido para ENVIAR_EMAIL');

    const assunto = interpolate(cfg.assunto, ctx);
    const corpo = interpolate(cfg.corpo, ctx);

    // Resend sistêmico (e-mail único da empresa). Recebe `para` como string e
    // lança em falha — propaga pro executor, que registra a falha do passo.
    const result = await this.resend.enviar({
      para: email,
      assunto,
      html: corpo,
    });
    return { para: email, assunto, messageId: result.id };
  }

  private async acaoCriarTarefa(
    cfg: CriarTarefaConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'CRIAR_TAREFA');
    // Determina usuário responsável: representante do cliente ou admin
    const clienteId = ctx['clienteId'] as string | undefined;
    let representanteId: string | undefined;
    if (clienteId) {
      // Exige que o cliente PERTENÇA à empresa do fluxo
      const cliente = await this.prisma.cliente.findFirst({
        where: { id: clienteId, empresaId },
        select: { representanteId: true },
      });
      if (!cliente) {
        throw new Error(`Cliente ${clienteId} não encontrado na empresa ${empresaId}`);
      }
      representanteId = cliente.representanteId ?? undefined;
    }
    // Fallback: primeiro ADMIN/DIRECTOR da empresa
    if (!representanteId) {
      const admin = await this.prisma.usuario.findFirst({
        where: {
          empresas: { some: { empresaId } },
          role: { in: ['ADMIN', 'DIRECTOR'] },
          status: 'ATIVO',
        },
        select: { id: true },
      });
      representanteId = admin?.id;
    }
    if (!representanteId) throw new Error('Nenhum usuário elegível para CRIAR_TAREFA');

    const titulo = interpolate(cfg.titulo, ctx);
    const diasOffset = cfg.diasApartirDeHoje ?? 0;
    const data = new Date();
    data.setDate(data.getDate() + diasOffset);

    const tarefa = await this.prisma.agendaItem.create({
      data: {
        empresaId,
        usuarioId: representanteId,
        clienteId: clienteId ?? null,
        titulo,
        data,
        tipo: cfg.tipo ?? 'TAREFA',
      },
    });
    return { tarefaId: tarefa.id, titulo, data: data.toISOString() };
  }

  private async acaoMudarTag(
    cfg: MudarTagConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'MUDAR_TAG');
    const clienteId = ctx['clienteId'] as string | undefined;
    if (!clienteId) throw new Error('contexto.clienteId ausente para MUDAR_TAG');

    // AUDITORIA 2026-05-15: exige cliente PERTENCER à empresa do fluxo
    const clienteOk = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      select: { id: true },
    });
    if (!clienteOk) {
      throw new Error(`Cliente ${clienteId} não encontrado na empresa ${empresaId}`);
    }

    // Sprint 2: Tag agora tem empresaId (@@unique([empresaId, nome])).
    // Upsert pela chave composta — tags são scoped por tenant.
    const tag = await this.prisma.tag.upsert({
      where: { empresaId_nome: { empresaId, nome: cfg.tagNome } },
      create: { empresaId, nome: cfg.tagNome },
      update: {},
    });

    if (cfg.operacao === 'adicionar') {
      await this.prisma.clienteTag.upsert({
        where: { clienteId_tagId: { clienteId, tagId: tag.id } },
        create: { clienteId, tagId: tag.id },
        update: {},
      });
    } else {
      await this.prisma.clienteTag.deleteMany({
        where: { clienteId, tagId: tag.id },
      });
    }
    return { tagId: tag.id, tagNome: cfg.tagNome, operacao: cfg.operacao };
  }

  private async acaoMoverLeadEtapa(
    cfg: MoverLeadEtapaConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'MOVER_LEAD_ETAPA');
    const leadId = ctx['leadId'] as string | undefined;
    if (!leadId) throw new Error('contexto.leadId ausente para MOVER_LEAD_ETAPA');

    // AUDITORIA 2026-05-15: updateMany com empresaId no where evita write
    // cross-tenant caso o contexto seja malformado.
    const { count } = await this.prisma.lead.updateMany({
      where: { id: leadId, empresaId },
      data: { etapa: cfg.etapa, etapaDesde: new Date() },
    });
    if (count === 0) {
      throw new Error(`Lead ${leadId} não encontrado na empresa ${empresaId}`);
    }
    return { leadId, novaEtapa: cfg.etapa };
  }

  private async acaoAtribuirRep(
    cfg: AtribuirRepConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'ATRIBUIR_REP');
    const clienteId = ctx['clienteId'] as string | undefined;
    const leadId = ctx['leadId'] as string | undefined;

    // AUDITORIA 2026-05-15: valida que o rep destino pertence à empresa
    const rep = await this.prisma.usuario.findFirst({
      where: {
        id: cfg.representanteId,
        empresas: { some: { empresaId } },
      },
      select: { id: true },
    });
    if (!rep) {
      throw new Error(`Rep ${cfg.representanteId} não pertence à empresa ${empresaId}`);
    }

    if (clienteId) {
      const { count } = await this.prisma.cliente.updateMany({
        where: { id: clienteId, empresaId },
        data: { representanteId: cfg.representanteId },
      });
      if (count === 0) {
        throw new Error(`Cliente ${clienteId} não encontrado na empresa ${empresaId}`);
      }
    }
    if (leadId) {
      const { count } = await this.prisma.lead.updateMany({
        where: { id: leadId, empresaId },
        data: { representanteId: cfg.representanteId },
      });
      if (count === 0) {
        throw new Error(`Lead ${leadId} não encontrado na empresa ${empresaId}`);
      }
    }
    if (!clienteId && !leadId)
      throw new Error('contexto sem clienteId nem leadId para ATRIBUIR_REP');
    return { representanteId: cfg.representanteId, clienteId, leadId };
  }

  /**
   * Helper de defesa em profundidade — todas as ações devem chamar isso antes
   * de executar qualquer DB write. Auditoria 2026-05-15: FluxoExecutor era
   * silenciosamente cross-tenant quando empresaId vinha vazio.
   */
  private assertEmpresaId(empresaId: string | undefined | null, acao: string): void {
    if (!empresaId || empresaId.length === 0) {
      throw new Error(
        `empresaId ausente na execução de ${acao} — fluxo malformado ou bug no event bus`,
      );
    }
  }

  /**
   * LIBERAR_LOTE (orquestração) — move um lote controlado de leads de uma etapa
   * pra outra (anti-sobrecarga) e dispara LEAD_ETAPA_MUDOU pra cada um — assim os
   * fluxos da etapa destino (ex: "Primeira mensagem Betinna") rodam por lead.
   * Ordena por ordemPrioridade asc ("coluna LEO"; sem prioridade vai por último),
   * depois pelos mais antigos.
   */
  private async acaoLiberarLote(
    cfg: LiberarLoteConfig,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'LIBERAR_LOTE');
    if (!cfg.etapaOrigemId || !cfg.etapaDestinoId) {
      throw new Error('LIBERAR_LOTE exige etapaOrigemId e etapaDestinoId');
    }
    const quantidade = Math.min(Math.max(1, Math.trunc(cfg.quantidade ?? 50)), 500);

    // Etapa destino deve pertencer à empresa; o tipo sincroniza o enum legado.
    const destino = await this.prisma.funilEtapa.findFirst({
      where: { id: cfg.etapaDestinoId, funil: { empresaId } },
      select: { id: true, tipo: true },
    });
    if (!destino) {
      throw new Error(`Etapa destino ${cfg.etapaDestinoId} não encontrada na empresa ${empresaId}`);
    }
    const etapaEnum: 'NOVO' | 'GANHO' | 'PERDIDO' =
      destino.tipo === 'GANHO' ? 'GANHO' : destino.tipo === 'PERDIDO' ? 'PERDIDO' : 'NOVO';

    const leads = await this.prisma.lead.findMany({
      where: {
        empresaId,
        funilEtapaId: cfg.etapaOrigemId,
        ...(cfg.funilId ? { funilId: cfg.funilId } : {}),
      },
      orderBy: [{ ordemPrioridade: 'asc' }, { criadoEm: 'asc' }],
      take: quantidade,
      select: { id: true },
    });

    for (const lead of leads) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { funilEtapaId: cfg.etapaDestinoId, etapa: etapaEnum, etapaDesde: new Date() },
      });
      // Dispara os fluxos da etapa destino (1 por lead).
      await this.bus.disparar(empresaId, 'LEAD_ETAPA_MUDOU', {
        leadId: lead.id,
        deEtapaId: cfg.etapaOrigemId,
        paraEtapaId: cfg.etapaDestinoId,
      });
    }

    this.logger.log(
      `LIBERAR_LOTE: ${leads.length} lead(s) ${cfg.etapaOrigemId} → ${cfg.etapaDestinoId} (empresa ${empresaId})`,
    );
    return { movidos: leads.length, etapaDestinoId: cfg.etapaDestinoId };
  }

  private async acaoWebhookExterno(
    cfg: WebhookExternoConfig,
    ctx: ExecucaoContexto,
  ): Promise<Record<string, unknown>> {
    // AUDITORIA 2026-05-15 P1: SSRF protection.
    // URL é interpolada com variáveis do contexto (cliente/lead/etc) que podem
    // ter sido populadas a partir de input do usuário. Validamos via safeRequest:
    //  - Bloqueia http://localhost, 127.0.0.1, 169.254.169.254 (metadata cloud)
    //  - Bloqueia IPs privados (10.x, 172.16-31.x, 192.168.x, IPv6 link-local)
    //  - Apenas http/https schemes
    //  - Resolve DNS pra detectar rebinding
    //  - Timeout 10s + redirect manual
    const url = interpolate(cfg.url, ctx);
    const payload = cfg.payload
      ? (interpolateDeep(cfg.payload, ctx) as Record<string, unknown>)
      : {};
    const method = cfg.method ?? 'POST';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(cfg.headers ?? {}),
    };

    try {
      // Type narrowing: WebhookExternoConfig.method é sempre POST/PUT/PATCH (sem GET)
      const resp = await safeRequest(
        url,
        {
          method,
          headers,
          body: JSON.stringify(payload),
        },
        { timeoutMs: 10_000 },
      );
      return { url, status: resp.status, enviado: true };
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        this.logger.warn(`SSRF bloqueou webhook externo: ${err.message}`);
      }
      throw err;
    }
  }

  // ─── Helpers internos ───────────────────────────────────────────────

  private async marcarFalhou(execucaoId: string, msg: string): Promise<void> {
    await this.prisma.fluxoExecucao.update({
      where: { id: execucaoId },
      data: { status: 'FALHOU', terminouEm: new Date(), erroMsg: msg },
    });
    this.logger.error(`Execução ${execucaoId} marcada como FALHOU: ${msg}`);
  }
}
