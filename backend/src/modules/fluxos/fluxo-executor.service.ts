import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { FluxoNo, FluxoEdge } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { HttpClientService } from '@shared/http/http-client.service';
import { WhatsAppService } from '@integrations/whatsapp/whatsapp.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';
import { Prisma } from '@prisma/client';
import { safeRequest, SsrfBlockedError } from '@shared/utils/safe-request';
import { interpolate } from '@shared/utils/interpolate';
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
  type PausarIaConfig,
  type AtribuirRepConfig,
  type WebhookExternoConfig,
  type LiberarLoteConfig,
  type ExecucaoContexto,
} from './fluxo-executor.types';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Papéis válidos pra destinatário "papel:<ROLE>" do ENVIAR_EMAIL (evita enum inválido no Prisma). */
const PAPEIS_VALIDOS = new Set(['ADMIN', 'DIRECTOR', 'GERENTE', 'SAC', 'REP']);

/**
 * Interpola variáveis no formato {{caminho.ponto}} dentro de strings.
 * Exemplo: "Olá {{cliente.nome}}!" com { cliente: { nome: "João" } } → "Olá João!"
 */
// Util único em @shared (era cópia local). Re-exportado pra manter os
// importadores (specs) intactos. Default: variável ausente mantém `{{x}}`.
export { interpolate };

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

/**
 * Resolve a variável do roteador tentando o nome cru, depois `custom.<v>` e
 * `conversa.<v>` (a IA grava em uma dessas, dependendo do escopo).
 */
function resolveVariavel(nome: string, ctx: ExecucaoContexto): string {
  const raw =
    resolveField(nome, ctx) ??
    resolveField(`custom.${nome}`, ctx) ??
    resolveField(`conversa.${nome}`, ctx);
  return raw != null ? String(raw) : '';
}

/**
 * Avalia o nó CONDICAO e devolve o LABEL da aresta a seguir.
 * - modo 'roteador': casa o valor da `variavel` com uma das `saidas` (label = valor) ou 'default'.
 * - modo 'simples' (default): 'true' | 'false'.
 */
function avaliarCondicao(config: CondicaoConfig, ctx: ExecucaoContexto): string {
  if (config.modo === 'roteador') {
    const valor = resolveVariavel(config.variavel ?? '', ctx).trim();
    const match = (config.saidas ?? []).find((s) => s.trim().toLowerCase() === valor.toLowerCase());
    return match ?? 'default';
  }
  const val = resolveField(config.campo ?? '', ctx);
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
  // Os labels batem com o que o editor grava nas arestas da condição simples
  // (handle true→"Sim", false→"Não"). O roteamento filtra por e.label === retorno.
  return resultado ? 'Sim' : 'Não';
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
    private readonly emailSvc: TransactionalEmailService,
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
    // Nó "Conversar com IA" pulou o lead (ex: sem telefone): encerra limpo, sem
    // tratar como falha nem enfileirar sucessores.
    let pulado = false;
    let puladoMotivo: string | null = null;
    // Nó "Conversar com IA" capturou erro de IA/WhatsApp e roteou pela saída "erro"
    // (já gravou tipo_erro/mensagem_erro + enfileirou o ramo "erro"). O executor não
    // deve enfileirar o caminho normal nem tratar como falha.
    let roteado = false;
    let tipoErro: string | null = null;

    try {
      if (no.tipo === 'ACAO' && no.acaoTipo === 'CONVERSAR_IA') {
        const r = await this.conversarIa.iniciar(execucaoId, no, contexto, execucao.empresaId);
        aguardando = r.aguardando;
        pulado = r.pulado ?? false;
        puladoMotivo = r.motivo ?? null;
        roteado = r.roteado ?? false;
        tipoErro = r.tipoErro ?? null;
        output = {
          conversarIa: true,
          aguardando,
          ...(pulado ? { pulado, motivo: puladoMotivo } : {}),
          ...(roteado ? { erro: true, tipoErro } : {}),
        };
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

    // CONVERSAR_IA que desviou pela saída "erro" (whatsapp_falha / ia_*): loga o
    // passo como FALHOU (aparece VERMELHO no histórico, com o motivo) — SEM
    // relançar (o erro já foi tratado/roteado; não queremos retry do BullMQ).
    // Antes ficava verde "Concluída sem erros", mascarando que nada foi enviado.
    if (roteado && !erroMsg) {
      erroMsg = `Não enviado — falha "${tipoErro ?? 'erro'}" (seguiu a saída "erro" do nó)`;
    }

    // Registra log do passo
    const logStatus = sucesso && !roteado ? ('CONCLUIDO' as const) : ('FALHOU' as const);
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

    // Nó "Conversar com IA" roteou pela saída "erro": a execução já foi atualizada
    // e o ramo "erro" enfileirado pelo ConversarIaService. Não segue o caminho
    // normal nem encerra aqui.
    if (roteado) {
      this.logger.log(`Execução ${execucaoId} seguiu a saída "erro" (${tipoErro ?? '?'})`);
      return;
    }

    // Lead pulado (ex: sem telefone): encerra a execução limpa, SEM enfileirar
    // sucessores (não há conversa a ter). O motivo já ficou no log do passo.
    if (pulado) {
      await this.prisma.fluxoExecucao.update({
        where: { id: execucaoId },
        data: { status: 'CONCLUIDO', terminouEm: new Date() },
      });
      this.logger.log(`Execução ${execucaoId} encerrada (pulada: ${puladoMotivo ?? 'sem motivo'})`);
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

    // Defaults customizados da empresa (admin — VariavelCustomizada). Base do {{custom.*}}.
    const defaults: Record<string, unknown> = {};
    try {
      const vars = await this.prisma.variavelCustomizada.findMany({
        where: { empresaId },
        select: { chave: true, valorPadrao: true },
      });
      for (const v of vars) if (v.valorPadrao != null) defaults[v.chave] = v.valorPadrao;
    } catch {
      /* ignora — sem defaults */
    }

    // {{lead.*}} — dados estruturados do lead; leadVars alimenta {{custom.*}}/{{conversa.*}}.
    const leadId = typeof ctx.leadId === 'string' ? ctx.leadId : undefined;
    let leadVars: Record<string, unknown> = {};
    if (leadId) {
      try {
        const lead = await this.prisma.lead.findFirst({
          where: { id: leadId, empresaId },
          select: {
            nome: true,
            contatoNome: true,
            contatoTelefone: true,
            contatoEmail: true,
            cidade: true,
            uf: true,
            segmento: true,
            score: true,
            etapa: true,
            variaveis: true,
            funil: { select: { nome: true } },
            funilEtapa: { select: { nome: true } },
            tags: { select: { tag: { select: { nome: true } } } },
          },
        });
        if (lead) {
          if (lead.variaveis && typeof lead.variaveis === 'object') {
            leadVars = lead.variaveis as Record<string, unknown>;
          }
          ctx.lead = {
            nome: lead.nome,
            contato: lead.contatoNome ?? '',
            whatsapp: lead.contatoTelefone ?? '',
            email: lead.contatoEmail ?? '',
            cidade: lead.cidade ?? '',
            uf: lead.uf ?? '',
            segmento: lead.segmento ?? '',
            score: lead.score,
            etapa_atual: lead.funilEtapa?.nome ?? lead.etapa,
            funil: lead.funil?.nome ?? '',
            tags: lead.tags.map((t) => t.tag.nome).join(', '),
            empresa: (leadVars.empresa as string | undefined) ?? lead.nome,
          };
        }
      } catch {
        /* ignora — {{lead.*}} fica vazio */
      }
    }

    // {{custom.*}} = defaults da empresa sobrescritos pelas variáveis do lead.
    ctx.custom = { ...defaults, ...leadVars };
    // {{conversa.*}} = efêmero: variáveis do turno + texto/classificação do evento.
    ctx.conversa = {
      ...leadVars,
      ...(typeof ctx.texto === 'string' ? { ultima_msg_lead: ctx.texto } : {}),
      ...(typeof ctx.classificacao === 'string' ? { classificacao: ctx.classificacao } : {}),
    };
    if (ctx.lead == null) ctx.lead = {};

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

      case 'PAUSAR_IA':
        return this.acaoPausarIa(cfg as PausarIaConfig, ctx, empresaId);

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
    const mensagem = interpolate(cfg.mensagem, ctx);
    const modo = cfg.destinatarioModo ?? 'lead';

    // GRUPO do WhatsApp: o "contato salvo" pode ser um grupo (jid @g.us). O jid é
    // o destino direto — NÃO normaliza pra telefone (senão viraria um número
    // solto). O adapter (Baileys/Evolution) aceita o jid de grupo como remoteJid.
    if (modo === 'contato') {
      const alvo = (cfg.destinatarioContato ?? '').trim();
      if (alvo.endsWith('@g.us')) {
        const r = await this.whatsapp.enviarTexto(empresaId, alvo, mensagem, {});
        return { peerId: alvo, mensagem, modo, externalId: r.externalId };
      }
    }

    // Resolve o telefone do destinatário conforme o modo.
    let telefone: string | undefined;
    if (modo === 'numero') {
      telefone = interpolate(cfg.destinatarioNumero ?? '', ctx).replace(/\D/g, '');
      if (!telefone) throw new Error('ENVIAR_WHATSAPP: destinatário "número específico" vazio');
    } else if (modo === 'contato') {
      telefone = (cfg.destinatarioContato ?? '').replace(/\D/g, '');
      if (!telefone) throw new Error('ENVIAR_WHATSAPP: destinatário "contato" não selecionado');
    } else {
      // 'lead' (default): lead do contexto, senão cliente do contexto.
      telefone = await this.resolverTelefoneLeadOuCliente(ctx, empresaId);
      if (!telefone) {
        throw new Error('ENVIAR_WHATSAPP: contexto sem lead/cliente com telefone (modo "lead")');
      }
    }
    if (telefone.replace(/\D/g, '').length < 8) {
      throw new Error(`ENVIAR_WHATSAPP: telefone do destinatário inválido (${telefone})`);
    }

    const peerId = `${telefone}@s.whatsapp.net`;
    const result = await this.whatsapp.enviarTexto(empresaId, peerId, mensagem, {});
    return { peerId, mensagem, modo, externalId: result.externalId };
  }

  /** Telefone (só dígitos) do lead OU cliente do contexto, validado na empresa. */
  private async resolverTelefoneLeadOuCliente(
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<string | undefined> {
    const leadId = ctx['leadId'] as string | undefined;
    if (leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, empresaId },
        select: { contatoTelefone: true },
      });
      if (lead?.contatoTelefone) return lead.contatoTelefone.replace(/\D/g, '');
    }
    const clienteId = ctx['clienteId'] as string | undefined;
    if (clienteId) {
      const cliente = await this.prisma.cliente.findFirst({
        where: { id: clienteId, empresaId },
        select: { telefone: true },
      });
      if (cliente?.telefone) return cliente.telefone.replace(/\D/g, '');
    }
    return undefined;
  }

  private async acaoEnviarEmail(
    cfg: EnviarEmailConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'ENVIAR_EMAIL');
    const emails = await this.resolverDestinatarios(cfg, ctx, empresaId);
    if (emails.length === 0) {
      throw new Error('Nenhum destinatário resolvido para ENVIAR_EMAIL');
    }
    const assunto = interpolate(cfg.assunto, ctx);
    const corpo = interpolate(cfg.corpo, ctx);
    // Resend sistêmico — envia 1 e-mail por destinatário resolvido.
    const messageIds: string[] = [];
    for (const para of emails) {
      const r = await this.emailSvc.enviarHtmlLivre({ para, assunto, html: corpo });
      if (!r.ok) {
        throw new Error(`Falha ao enviar e-mail para ${para}: ${r.motivo ?? 'erro no provedor'}`);
      }
      if (r.id) messageIds.push(r.id);
    }
    return { destinatarios: emails, assunto, messageIds };
  }

  /**
   * Resolve a lista de e-mails dos destinatários. Cada token pode ser: e-mail
   * cru, `user:<id>` (e-mail do usuário), `papel:<ROLE>` (todos da empresa com o
   * papel) ou `{{variável}}` (interpolada). Fallback = e-mail do cliente do ctx.
   */
  private async resolverDestinatarios(
    cfg: EnviarEmailConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<string[]> {
    const tokens =
      cfg.destinatarios && cfg.destinatarios.length > 0
        ? cfg.destinatarios
        : cfg.destinatario
          ? [cfg.destinatario]
          : [];
    const emails = new Set<string>();
    for (const raw of tokens) {
      const tok = interpolate(raw, ctx).trim();
      if (!tok) continue;
      if (tok.startsWith('user:')) {
        const u = await this.prisma.usuario.findFirst({
          where: { id: tok.slice(5), empresas: { some: { empresaId } } },
          select: { email: true },
        });
        if (u?.email) emails.add(u.email);
      } else if (tok.startsWith('papel:')) {
        const role = tok.slice(6);
        // Valida o papel ANTES da query — papel inválido (typo/minúsculo) faria o
        // Prisma lançar erro de enum e derrubar o envio aos demais destinatários.
        if (!PAPEIS_VALIDOS.has(role)) continue;
        const us = await this.prisma.usuario.findMany({
          where: {
            role: role as 'ADMIN' | 'DIRECTOR' | 'GERENTE' | 'SAC' | 'REP',
            status: 'ATIVO',
            empresas: { some: { empresaId } },
          },
          select: { email: true },
        });
        for (const u of us) if (u.email) emails.add(u.email);
      } else {
        emails.add(tok); // e-mail cru (ou já interpolado de {{var}})
      }
    }
    if (emails.size === 0) {
      const clienteId = ctx['clienteId'] as string | undefined;
      if (clienteId) {
        const c = await this.prisma.cliente.findFirst({
          where: { id: clienteId, empresaId },
          select: { email: true },
        });
        if (c?.email) emails.add(c.email);
      }
    }
    return [...emails];
  }

  private async acaoCriarTarefa(
    cfg: CriarTarefaConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'CRIAR_TAREFA');
    const clienteId = ctx['clienteId'] as string | undefined;
    // Defesa-em-profundidade: se o contexto traz clienteId, ele PRECISA pertencer
    // à empresa do fluxo — independente do caminho de responsável. Sem isso, um
    // contexto malformado anexaria um cliente de outro tenant à tarefa.
    let clienteRepId: string | null | undefined;
    if (clienteId) {
      const cliente = await this.prisma.cliente.findFirst({
        where: { id: clienteId, empresaId },
        select: { representanteId: true },
      });
      if (!cliente) {
        throw new Error(`Cliente ${clienteId} não encontrado na empresa ${empresaId}`);
      }
      clienteRepId = cliente.representanteId;
    }
    // Responsável: 1) o escolhido no nó (validado na empresa); 2) rep do cliente;
    // 3) fallback primeiro ADMIN/DIRECTOR.
    let responsavelId: string | undefined = cfg.responsavelId || undefined;
    if (responsavelId) {
      const u = await this.prisma.usuario.findFirst({
        where: { id: responsavelId, empresas: { some: { empresaId } } },
        select: { id: true },
      });
      if (!u) responsavelId = undefined; // id inválido/foreign → cai no fallback
    }
    if (!responsavelId && clienteId) {
      responsavelId = clienteRepId ?? undefined;
    }
    if (!responsavelId) {
      const admin = await this.prisma.usuario.findFirst({
        where: {
          empresas: { some: { empresaId } },
          role: { in: ['ADMIN', 'DIRECTOR'] },
          status: 'ATIVO',
        },
        select: { id: true },
      });
      responsavelId = admin?.id;
    }
    if (!responsavelId) throw new Error('Nenhum usuário elegível para CRIAR_TAREFA');

    const titulo = interpolate(cfg.titulo, ctx);
    const observacao = cfg.descricao ? interpolate(cfg.descricao, ctx) : undefined;
    const data = new Date();
    data.setDate(data.getDate() + (cfg.diasApartirDeHoje ?? 0));

    const tarefa = await this.prisma.agendaItem.create({
      data: {
        empresaId,
        usuarioId: responsavelId,
        clienteId: clienteId ?? null,
        titulo,
        data,
        tipo: cfg.tipo ?? 'TAREFA',
        ...(observacao ? { observacao } : {}),
      },
    });
    return { tarefaId: tarefa.id, titulo, responsavelId, data: data.toISOString() };
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

    // Preferencial: etapa do FUNIL customizado (id). Valida que é da empresa e
    // sincroniza o enum legado a partir do tipo terminal (fonte da verdade = funil).
    if (cfg.funilEtapaId) {
      const etapa = await this.prisma.funilEtapa.findFirst({
        where: { id: cfg.funilEtapaId, funil: { empresaId } },
        select: { id: true, funilId: true, tipo: true },
      });
      if (!etapa) {
        throw new Error(`Etapa ${cfg.funilEtapaId} não encontrada na empresa ${empresaId}`);
      }
      const enumEtapa =
        etapa.tipo === 'GANHO' ? 'GANHO' : etapa.tipo === 'PERDIDO' ? 'PERDIDO' : 'QUALIFICANDO';
      // Captura a etapa de origem ANTES de mover (pro filtro "deEtapa" do gatilho
      // e pra só disparar quando a etapa realmente muda).
      const antes = await this.prisma.lead.findFirst({
        where: { id: leadId, empresaId },
        select: { funilEtapaId: true },
      });
      const origemId = antes?.funilEtapaId ?? undefined;
      const { count } = await this.prisma.lead.updateMany({
        where: { id: leadId, empresaId },
        data: {
          funilEtapaId: etapa.id,
          funilId: etapa.funilId,
          etapa: enumEtapa,
          etapaDesde: new Date(),
        },
      });
      if (count === 0) throw new Error(`Lead ${leadId} não encontrado na empresa ${empresaId}`);
      // Lead mudou de etapa → dispara LEAD_ETAPA_MUDOU pros fluxos da etapa destino
      // (ex: "Primeira Abordagem"), mesma semântica do LIBERAR_LOTE. Só quando a
      // etapa realmente muda, pra não disparar em re-move no-op nem criar laço.
      if (origemId !== etapa.id) {
        await this.bus.disparar(empresaId, 'LEAD_ETAPA_MUDOU', {
          leadId,
          funilId: etapa.funilId,
          deFunilEtapaId: origemId,
          paraFunilEtapaId: etapa.id,
        });
      }
      return { leadId, funilEtapaId: etapa.id };
    }

    // Fallback: enum legado.
    if (!cfg.etapa) throw new Error('MOVER_LEAD_ETAPA sem funilEtapaId nem etapa definidos');
    // AUDITORIA 2026-05-15: updateMany com empresaId no where evita write cross-tenant.
    const { count } = await this.prisma.lead.updateMany({
      where: { id: leadId, empresaId },
      data: { etapa: cfg.etapa, etapaDesde: new Date() },
    });
    if (count === 0) {
      throw new Error(`Lead ${leadId} não encontrado na empresa ${empresaId}`);
    }
    return { leadId, novaEtapa: cfg.etapa };
  }

  /**
   * PAUSAR_IA — desliga (ou religa) o bot na conversa de WhatsApp do lead, setando
   * `Conversation.botLigado`. Acha a conversa por sufixo de telefone (D18). O bot
   * para de responder mensagens novas daquele lead até alguém religar manualmente.
   */
  private async acaoPausarIa(
    cfg: PausarIaConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'PAUSAR_IA');
    const leadId = ctx['leadId'] as string | undefined;
    if (!leadId) throw new Error('contexto.leadId ausente para PAUSAR_IA');
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, empresaId },
      select: { contatoTelefone: true },
    });
    if (!lead?.contatoTelefone) {
      throw new Error(`Lead ${leadId} sem contatoTelefone para PAUSAR_IA`);
    }
    const sufixo = lead.contatoTelefone.replace(/\D/g, '').slice(-8);
    if (sufixo.length < 8) throw new Error('Telefone do lead curto demais para casar a conversa');
    const religar = cfg.religar === true;
    // Religar devolve o controle ao bot de fato: além de botLigado, limpa o
    // botPausadoAte (handoff/anti-spam) e o precisaHumano — senão o gate do bot
    // continuaria mudo apesar de "ligado" (mesmo caminho do inbox.setBotLigado).
    const { count } = await this.prisma.conversation.updateMany({
      where: { empresaId, canal: 'WHATSAPP', peerId: { contains: sufixo } },
      data: religar
        ? { botLigado: true, botPausadoAte: null, precisaHumano: false }
        : { botLigado: false },
    });
    return { leadId, sufixo, botLigado: religar, conversasAtualizadas: count };
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
      select: { id: true, funilId: true, tipo: true, capacidadeMaxima: true },
    });
    if (!destino) {
      throw new Error(`Etapa destino ${cfg.etapaDestinoId} não encontrada na empresa ${empresaId}`);
    }
    const etapaEnum: 'NOVO' | 'GANHO' | 'PERDIDO' =
      destino.tipo === 'GANHO' ? 'GANHO' : destino.tipo === 'PERDIDO' ? 'PERDIDO' : 'NOVO';

    // Capacidade máxima da etapa destino (anti-sobrecarga): nunca libera além das vagas.
    let limite = quantidade;
    if (destino.capacidadeMaxima != null) {
      const ocupacao = await this.prisma.lead.count({
        where: { empresaId, funilEtapaId: cfg.etapaDestinoId },
      });
      limite = Math.min(quantidade, Math.max(0, destino.capacidadeMaxima - ocupacao));
    }
    if (limite === 0) {
      this.logger.log(`LIBERAR_LOTE: etapa destino ${cfg.etapaDestinoId} cheia — nada liberado`);
      return { movidos: 0, etapaDestinoId: cfg.etapaDestinoId, motivo: 'etapa destino cheia' };
    }

    // Exclui leads que tenham QUALQUER uma das tags marcadas (ex: 'pausado' —
    // tira manualmente da fila sem deletar).
    const excluiTags = (cfg.filtroExcluiTag ?? []).filter(
      (t) => typeof t === 'string' && t.trim().length > 0,
    );
    const where: Prisma.LeadWhereInput = {
      empresaId,
      funilEtapaId: cfg.etapaOrigemId,
      ...(cfg.funilId ? { funilId: cfg.funilId } : {}),
      ...(excluiTags.length
        ? { NOT: { tags: { some: { tag: { nome: { in: excluiTags } } } } } }
        : {}),
      // Só com WhatsApp: descarta leads sem número (null/vazio) antes de liberar,
      // pra não jogar na etapa de abordagem quem a IA não consegue contatar.
      // (O nó "Conversar com IA" ainda pula nº curto/inválido como backstop.)
      ...(cfg.filtroSoComWhatsapp
        ? { AND: [{ contatoTelefone: { not: null } }, { contatoTelefone: { not: '' } }] }
        : {}),
    };

    let leads: Array<{ id: string }>;
    if (cfg.criterioOrdem === 'custom' && cfg.campoOrdem?.trim()) {
      // Ordena por uma chave de Lead.variaveis (JSON) em memória — Prisma não
      // ordena por chave de JSON direto. Cap de 2000 candidatos (prospecção cabe).
      const key = cfg.campoOrdem.trim();
      const dir = cfg.ordemDir === 'desc' ? -1 : 1;
      const cand = await this.prisma.lead.findMany({
        where,
        take: 2000,
        select: { id: true, variaveis: true },
      });
      const valorDe = (l: { variaveis: unknown }): unknown => {
        const v = l.variaveis;
        return v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined;
      };
      cand.sort((a, b) => {
        const va = valorDe(a);
        const vb = valorDe(b);
        // null/ausente sempre por último, independente da direção.
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const na = Number(va);
        const nb = Number(vb);
        const cmp =
          Number.isFinite(na) && Number.isFinite(nb)
            ? na - nb
            : String(va).localeCompare(String(vb));
        return cmp * dir;
      });
      leads = cand.slice(0, limite).map((l) => ({ id: l.id }));
    } else {
      const orderBy: Prisma.LeadOrderByWithRelationInput[] =
        cfg.criterioOrdem === 'antigos'
          ? [{ criadoEm: 'asc' }]
          : cfg.criterioOrdem === 'novos'
            ? [{ criadoEm: 'desc' }]
            : [{ ordemPrioridade: 'asc' }, { criadoEm: 'asc' }]; // legado (default)
      leads = await this.prisma.lead.findMany({
        where,
        orderBy,
        take: limite,
        select: { id: true },
      });
    }

    for (const lead of leads) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { funilEtapaId: cfg.etapaDestinoId, etapa: etapaEnum, etapaDesde: new Date() },
      });
      // Dispara os fluxos da etapa destino (1 por lead). Nomes canônicos +
      // funilId pra o filtro do gatilho "Lead mudou etapa" casar (FluxoEventBus).
      await this.bus.disparar(empresaId, 'LEAD_ETAPA_MUDOU', {
        leadId: lead.id,
        funilId: destino.funilId,
        deFunilEtapaId: cfg.etapaOrigemId,
        paraFunilEtapaId: cfg.etapaDestinoId,
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
