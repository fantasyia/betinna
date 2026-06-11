import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { MessageDirection, Prisma } from '@prisma/client';
import type { FluxoNo } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { WhatsAppService } from '@integrations/whatsapp/whatsapp.service';
import { MullerBotService } from '@modules/mullerbot/mullerbot.service';
import { MullerBotPersonaService } from '@modules/mullerbot/persona.service';
import { dividirEmBaloes } from '@modules/mullerbot/muller-whatsapp.service';
import type { HistoricoMsg } from '@modules/mullerbot/mullerbot-cache.service';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import {
  FLUXO_QUEUE,
  type FluxoStepJobData,
  type ConversarIaConfig,
  type ExecucaoContexto,
} from './fluxo-executor.types';

const HISTORICO_MAX = 12;

/**
 * Interpola {{caminho.ponto}} numa string (cópia local pra evitar ciclo de
 * import com o executor — mesma semântica do `interpolate` de lá).
 */
function interpolate(template: string, ctx: ExecucaoContexto): string {
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

/** Instrução pra IA abrir a conversa (primeira mensagem). */
const INSTRUCAO_OPENER =
  '\n\n[Tarefa agora] Inicie a conversa com o lead: escreva a PRIMEIRA mensagem de abordagem, ' +
  'curta e natural (estilo WhatsApp). Pode separar em 2-3 mensagens curtas com "|||". ' +
  'Responda apenas com a mensagem, sem aspas nem rótulos.';

/** Primeiro nome a partir do nome completo (vazio se não houver). */
function primeiroNomeDe(nome?: string | null): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * Substitui placeholders de nome que prompts costumam usar (`[primeiro_nome]`,
 * `{{nome}}`, `{nome}`, etc.) pelo primeiro nome real do lead. A IA às vezes
 * devolve o placeholder cru quando não tem o dado — isto é a rede de segurança
 * pra esse texto NUNCA chegar assim no cliente.
 */
export function personalizarNome(texto: string, nome?: string | null): string {
  const primeiro = primeiroNomeDe(nome);
  const re =
    /\[\s*(?:primeiro[_ ]?nome|first[_ ]?name|nome)\s*\]|\{\{?\s*(?:primeiro[_ ]?nome|first[_ ]?name|nome)\s*\}?\}/gi;
  let out = texto.replace(re, primeiro);
  if (!primeiro) {
    // Sem nome: limpa pontuação/espaço órfãos deixados pelo placeholder vazio
    // (ex: ", boa tarde!" → "boa tarde!"; "Olá , tudo bem" → "Olá, tudo bem").
    out = out
      .replace(/\s+([,.!?;])/g, '$1')
      .replace(/([,;])\s*\1/g, '$1')
      .replace(/ {2,}/g, ' ')
      .replace(/^[\s,;:–-]+/, '');
  }
  return out.trim();
}

/** Instrução pra IA responder em JSON estruturado (permite classificar o lead). */
const INSTRUCAO_CLASSIFICACAO =
  '\n\n[Formato de resposta OBRIGATÓRIO] Responda SEMPRE com um JSON válido e NADA além dele:\n' +
  '{"resposta": "<mensagem pro lead>", "classificou": <true|false>, ' +
  '"classificacao": "<rótulo curto, só se classificou>", "variaveis": { <dados capturados> }}\n' +
  '- "resposta": o que enviar agora pro lead no WhatsApp (curto, natural).\n' +
  '- "classificou": true SOMENTE quando já houver informação suficiente pra concluir/classificar; ' +
  'senão false e continue a conversa.\n' +
  '- "classificacao"/"variaveis": só quando "classificou" for true.';

interface IaTurno {
  resposta: string;
  classificou: boolean;
  classificacao?: string;
  variaveis?: Record<string, unknown>;
}

/** Extrai o JSON do turno da IA. Tolerante a cercas ```json e a texto puro. */
export function parseTurnoIa(texto: string): IaTurno {
  const limpo = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    const obj = JSON.parse(limpo) as Record<string, unknown>;
    if (obj && typeof obj === 'object' && typeof obj.resposta === 'string') {
      return {
        resposta: obj.resposta,
        classificou: obj.classificou === true,
        classificacao: typeof obj.classificacao === 'string' ? obj.classificacao : undefined,
        variaveis:
          obj.variaveis && typeof obj.variaveis === 'object'
            ? (obj.variaveis as Record<string, unknown>)
            : undefined,
      };
    }
  } catch {
    /* não é JSON — trata como texto puro (continua conversando) */
  }
  return { resposta: texto, classificou: false };
}

const toJsonInput = (v: Record<string, unknown>): Prisma.InputJsonObject =>
  v as unknown as Prisma.InputJsonObject;

/**
 * ConversarIaService (Fase B) — motor do nó "Conversar com IA".
 *
 * Ciclo:
 *  1. `iniciar` (chamado pelo executor): compila o prompt do nó, gera a 1ª
 *     mensagem via OpenAI, envia no WhatsApp do lead e PAUSA o fluxo (AGUARDANDO).
 *  2. `retomar` (chamado quando o lead responde): roda 1 turno da IA com histórico;
 *     se a IA classificar, grava em Lead.variaveis, dispara IA_CLASSIFICOU e avança
 *     o fluxo; senão, segue conversando (continua AGUARDANDO).
 *  3. `processarTimeouts` (cron): execuções paradas além do timeout disparam
 *     LEAD_SEM_RESPOSTA e são encerradas.
 */
@Injectable()
export class ConversarIaService {
  private readonly logger = new Logger(ConversarIaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly persona: MullerBotPersonaService,
    private readonly muller: MullerBotService,
    private readonly whatsapp: WhatsAppService,
    private readonly bus: FluxoEventBusService,
    @InjectQueue(FLUXO_QUEUE) private readonly queue: Queue<FluxoStepJobData>,
  ) {}

  /**
   * Primeira passada do nó (vinda do executor). Retorna se o fluxo ficou pausado
   * (`aguardando`) e/ou se o lead foi pulado limpo (`pulado` — ex: sem telefone),
   * caso em que a execução encerra sem falhar nem enfileirar sucessores.
   */
  async iniciar(
    execucaoId: string,
    no: FluxoNo,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<{ aguardando: boolean; pulado?: boolean; motivo?: string }> {
    const cfg = (no.config ?? {}) as ConversarIaConfig;
    const leadId = typeof ctx.leadId === 'string' ? ctx.leadId : undefined;
    // Sem lead no contexto não há a quem abordar. Acontece em teste manual sem lead
    // ou fluxo mal-configurado (gatilho que não carrega lead). Re-tentar não resolve
    // → pula limpo com motivo claro, em vez de falhar 3× no BullMQ.
    if (!leadId) {
      this.logger.warn(`CONVERSAR_IA: contexto sem leadId — pulado (exec ${execucaoId})`);
      return {
        aguardando: false,
        pulado: true,
        motivo:
          'contexto sem lead — o nó "Conversar com IA" precisa de um lead (no teste manual, escolha um lead)',
      };
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, empresaId },
      select: { contatoTelefone: true, contatoNome: true },
    });
    // Sem WhatsApp não há como abordar: pula limpo (não é falha — o lead só não
    // tem número). A execução encerra com o motivo registrado no log do passo.
    if (!lead?.contatoTelefone || lead.contatoTelefone.replace(/\D/g, '').length < 8) {
      this.logger.warn(
        `CONVERSAR_IA: lead ${leadId} sem telefone válido — pulado (exec ${execucaoId})`,
      );
      return {
        aguardando: false,
        pulado: true,
        motivo: 'lead sem telefone de WhatsApp — abordagem pulada',
      };
    }

    // Teto de tokens do prompt (Fase C — spec §7).
    if (!(await this.tetoPromptOk(cfg.promptId))) {
      this.logger.warn(
        `Prompt ${cfg.promptId} atingiu o teto de tokens — CONVERSAR_IA pulado (exec ${execucaoId})`,
      );
      return { aguardando: false };
    }

    const systemPrompt = interpolate(
      await this.persona.compilarSystemPromptConversa(empresaId, cfg.promptId),
      ctx,
    );
    // Passa o primeiro nome do lead pra IA (pra ela saudar pelo nome de verdade,
    // em vez de devolver "[primeiro_nome]" cru).
    const primeiro = primeiroNomeDe(lead.contatoNome);
    const opener =
      INSTRUCAO_OPENER +
      (primeiro ? `\n[Dado] O primeiro nome do lead é "${primeiro}". Use-o na saudação.` : '');
    const abertura = await this.muller.gerarRespostaIa(
      empresaId,
      systemPrompt + opener,
      '(inicie)',
      [],
    );
    await this.registrarUsoPrompt(
      cfg.promptId,
      (abertura.tokensIn ?? 0) + (abertura.tokensOut ?? 0),
    );
    const aberturaTexto = personalizarNome(abertura.texto, lead.contatoNome);
    await this.enviarWhatsapp(empresaId, lead.contatoTelefone, aberturaTexto);

    const aguardar = cfg.aguardarResposta ?? true;
    if (!aguardar) return { aguardando: false };

    const horas = cfg.timeoutHoras ?? 24;
    await this.prisma.fluxoExecucao.update({
      where: { id: execucaoId },
      data: {
        status: 'AGUARDANDO',
        aguardandoNoId: no.id,
        timeoutEm: new Date(Date.now() + horas * 3_600_000),
        // Memória da conversa da IA (no contexto da execução): guarda a abertura
        // pra a IA NÃO se reapresentar quando o lead responder. O fluxo manda via
        // whatsapp.enviarTexto (sem gravar na conversa do inbox), então sem isto
        // o montarHistorico não tinha as mensagens do bot → IA repetia o opener.
        contexto: toJsonInput({
          ...ctx,
          _iaHistorico: [{ role: 'assistant', content: aberturaTexto, at: Date.now() }],
        }),
      },
    });
    this.logger.log(`Execução ${execucaoId} pausada (Conversar com IA) — lead ${leadId}`);
    return { aguardando: true };
  }

  /** Existe execução pausada (AGUARDANDO) esperando resposta deste lead? */
  async aguardandoPorLead(empresaId: string, leadId: string): Promise<{ id: string } | null> {
    return this.prisma.fluxoExecucao.findFirst({
      where: {
        empresaId,
        status: 'AGUARDANDO',
        contexto: { path: ['leadId'], equals: leadId },
      },
      orderBy: { criadoEm: 'desc' },
      select: { id: true },
    });
  }

  /** Lead respondeu — roda 1 turno da IA e avança o fluxo se classificou. */
  async retomar(
    execucaoId: string,
    conversationId: string | null,
    textoLead: string,
  ): Promise<void> {
    const execucao = await this.prisma.fluxoExecucao.findUnique({ where: { id: execucaoId } });
    if (!execucao || execucao.status !== 'AGUARDANDO' || !execucao.aguardandoNoId) return;
    if (!execucao.empresaId) return;
    const empresaId = execucao.empresaId;

    const no = await this.prisma.fluxoNo.findUnique({ where: { id: execucao.aguardandoNoId } });
    if (!no) return;
    const cfg = (no.config ?? {}) as ConversarIaConfig;
    const ctx = execucao.contexto as ExecucaoContexto;
    const leadId = typeof ctx.leadId === 'string' ? ctx.leadId : undefined;
    if (!leadId) return;

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, empresaId },
      select: { contatoTelefone: true, contatoNome: true, variaveis: true },
    });
    if (!lead?.contatoTelefone) return;

    // Variáveis que a IA pode gravar (nó "Conversar com IA" — spec §2.5).
    const gravaveis = (cfg.variaveisGravadas ?? []).filter(
      (v) => typeof v === 'string' && v.trim().length > 0,
    );
    const systemPrompt =
      interpolate(await this.persona.compilarSystemPromptConversa(empresaId, cfg.promptId), ctx) +
      INSTRUCAO_CLASSIFICACAO +
      (gravaveis.length
        ? `\n- Em "variaveis", grave APENAS estas chaves: ${gravaveis.join(', ')}.`
        : '');
    // Histórico da conversa = memória da IA no contexto da execução (inclui o
    // opener + os turnos), com fallback pro montarHistorico (execuções antigas).
    // Sem isto a IA não via as próprias mensagens e se reapresentava a cada resposta.
    const ctxHist = (ctx as Record<string, unknown>)._iaHistorico;
    const historico: HistoricoMsg[] = Array.isArray(ctxHist)
      ? (ctxHist as HistoricoMsg[])
      : conversationId
        ? await this.montarHistorico(conversationId)
        : [];

    if (!(await this.tetoPromptOk(cfg.promptId))) {
      await this.enviarWhatsapp(
        empresaId,
        lead.contatoTelefone,
        'Só um instante, já te respondo. 🙏',
      );
      return; // teto de tokens do prompt atingido — não roda a IA agora
    }
    const r = await this.muller.gerarRespostaIa(empresaId, systemPrompt, textoLead, historico);
    await this.registrarUsoPrompt(cfg.promptId, (r.tokensIn ?? 0) + (r.tokensOut ?? 0));
    const turno = parseTurnoIa(r.texto);

    const respostaTexto = personalizarNome(turno.resposta, lead.contatoNome);
    await this.enviarWhatsapp(empresaId, lead.contatoTelefone, respostaTexto);

    // Atualiza a memória da conversa (pergunta do lead + resposta da IA).
    const novoHist: HistoricoMsg[] = [
      ...historico,
      { role: 'user' as const, content: textoLead, at: Date.now() },
      { role: 'assistant' as const, content: respostaTexto, at: Date.now() },
    ].slice(-HISTORICO_MAX);

    if (!turno.classificou) {
      // Continua conversando — renova o timeout e persiste a memória da conversa.
      const horas = cfg.timeoutHoras ?? 24;
      await this.prisma.fluxoExecucao.update({
        where: { id: execucaoId },
        data: {
          timeoutEm: new Date(Date.now() + horas * 3_600_000),
          contexto: toJsonInput({ ...ctx, _iaHistorico: novoHist }),
        },
      });
      return;
    }

    // Classificou — grava variáveis no lead, dispara gatilho e avança o fluxo.
    const variaveisAtuais =
      lead.variaveis && typeof lead.variaveis === 'object'
        ? (lead.variaveis as Record<string, unknown>)
        : {};
    // Filtra pro conjunto permitido (se o nó restringe as variáveis graváveis).
    let gravadas = turno.variaveis ?? {};
    if (gravaveis.length) {
      const permitidas = new Set(gravaveis);
      gravadas = Object.fromEntries(Object.entries(gravadas).filter(([k]) => permitidas.has(k)));
    }
    const novas: Record<string, unknown> = {
      ...variaveisAtuais,
      ...gravadas,
    };
    if (turno.classificacao) novas.classificacao = turno.classificacao;
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { variaveis: toJsonInput(novas) },
    });

    await this.bus.disparar(empresaId, 'IA_CLASSIFICOU', {
      leadId,
      classificacao: turno.classificacao ?? null,
    });

    await this.prisma.fluxoExecucao.update({
      where: { id: execucaoId },
      data: { status: 'EM_EXECUCAO', aguardandoNoId: null, timeoutEm: null },
    });
    // Segue o ramo "classificou" (aresta com label 'classificou'); inclui arestas
    // SEM label pra compat com nós antigos de uma saída só.
    await this.enfileirarSucessores(execucaoId, no.id, 'classificou', true);
    this.logger.log(
      `Execução ${execucaoId} retomada — IA classificou "${turno.classificacao ?? '?'}" (lead ${leadId})`,
    );
  }

  /**
   * Cron — execuções paradas além do timeout. Se o nó tem uma saída "timeout"
   * (aresta com label 'timeout'), CONTINUA o fluxo por ela (ex: nó de follow-up).
   * Senão, mantém o comportamento antigo: dispara LEAD_SEM_RESPOSTA e encerra.
   */
  async processarTimeouts(): Promise<number> {
    const vencidas = await this.prisma.fluxoExecucao.findMany({
      where: { status: 'AGUARDANDO', timeoutEm: { lt: new Date() } },
      select: { id: true, empresaId: true, contexto: true, aguardandoNoId: true },
      take: 200,
    });
    let comRamo = 0;
    for (const ex of vencidas) {
      const ctx = ex.contexto as ExecucaoContexto;
      const leadId = typeof ctx.leadId === 'string' ? ctx.leadId : undefined;

      const arestasTimeout = ex.aguardandoNoId
        ? await this.prisma.fluxoEdge.findMany({
            where: { sourceNoId: ex.aguardandoNoId, label: 'timeout' },
          })
        : [];

      if (arestasTimeout.length > 0) {
        // Continua o fluxo pelo ramo "timeout" (o branch explícito supera o
        // gatilho global LEAD_SEM_RESPOSTA — evita tratar o lead em dobro).
        await this.prisma.fluxoExecucao.update({
          where: { id: ex.id },
          data: { status: 'EM_EXECUCAO', aguardandoNoId: null, timeoutEm: null },
        });
        for (const e of arestasTimeout) {
          await this.enfileirarStep(ex.id, e.targetNoId);
        }
        comRamo++;
        continue;
      }

      // Sem ramo "timeout": dispara LEAD_SEM_RESPOSTA e encerra.
      if (ex.empresaId && leadId) {
        await this.bus.disparar(ex.empresaId, 'LEAD_SEM_RESPOSTA', { leadId });
      }
      await this.prisma.fluxoExecucao.update({
        where: { id: ex.id },
        data: {
          status: 'CONCLUIDO',
          aguardandoNoId: null,
          timeoutEm: null,
          terminouEm: new Date(),
        },
      });
    }
    if (vencidas.length > 0) {
      this.logger.log(
        `${vencidas.length} execução(ões) de IA expiraram (${comRamo} seguiram o ramo "timeout")`,
      );
    }
    return vencidas.length;
  }

  // ─── Internals ──────────────────────────────────────────────────────

  /**
   * Envia no WhatsApp do lead respeitando a persona do bot: quando "quebrar em
   * balões" está ligado, manda várias mensagens curtas (mais humano), com
   * "digitando…" e pausa entre elas — mesma lógica do bot do inbox. A IA separa
   * com "|||" (ou parágrafo); o split acontece aqui no envio.
   */
  private async enviarWhatsapp(empresaId: string, telefone: string, texto: string): Promise<void> {
    const limpo = texto.trim();
    if (!limpo) return;
    const peerId = `${telefone.replace(/\D/g, '')}@s.whatsapp.net`;

    const cfg = await this.persona.obterConfigBot(empresaId).catch(() => null);
    const baloes = cfg?.quebrarMensagens
      ? dividirEmBaloes(limpo, cfg.maxMensagens)
      : [limpo.replace(/\s*\|\|\|\s*/g, ' ').trim()];
    const finais = baloes.filter(Boolean);
    if (finais.length === 0) finais.push(limpo);

    for (let i = 0; i < finais.length; i++) {
      const balao = finais[i];
      // 1º balão sai na hora; os próximos levam uma pausa curta proporcional ao
      // tamanho (≈ digitação) — também preserva a ORDEM de entrega no WhatsApp.
      const esperaMs = i === 0 ? 0 : Math.min(4000, 600 + balao.length * 25);
      if (cfg?.mostrarDigitando) {
        void this.whatsapp.enviarPresenca(empresaId, peerId, 'composing', esperaMs).catch(() => {});
      }
      if (esperaMs > 0) await new Promise((r) => setTimeout(r, esperaMs));
      await this.whatsapp.enviarTexto(empresaId, peerId, balao, {});
      if (cfg?.mostrarDigitando) {
        await this.whatsapp.enviarPresenca(empresaId, peerId, 'paused').catch(() => {});
      }
    }
  }

  // ─── Teto de tokens por prompt (Fase C — spec §7) ────────────────────

  private dataRefs(): { dia: string; mes: string } {
    const d = new Date();
    const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    return { dia, mes: dia.slice(0, 7) };
  }

  /** True se o prompt ainda pode rodar (não estourou o teto de tokens dia/mês). */
  private async tetoPromptOk(promptId?: string): Promise<boolean> {
    if (!promptId) return true;
    try {
      const p = await this.prisma.botPrompt.findUnique({
        where: { id: promptId },
        select: {
          tetoTokensDia: true,
          tetoTokensMes: true,
          usoTokensDia: true,
          usoDiaRef: true,
          usoTokensMes: true,
          usoMesRef: true,
        },
      });
      if (!p) return true;
      const { dia, mes } = this.dataRefs();
      const usoDia = p.usoDiaRef === dia ? p.usoTokensDia : 0;
      const usoMes = p.usoMesRef === mes ? p.usoTokensMes : 0;
      if (p.tetoTokensDia != null && usoDia >= p.tetoTokensDia) return false;
      if (p.tetoTokensMes != null && usoMes >= p.tetoTokensMes) return false;
      return true;
    } catch {
      return true; // fail-open: erro no check não pode travar a conversa
    }
  }

  /** Acumula os tokens usados pelo prompt, com reset por dia/mês. */
  private async registrarUsoPrompt(promptId: string | undefined, tokens: number): Promise<void> {
    if (!promptId || tokens <= 0) return;
    try {
      const p = await this.prisma.botPrompt.findUnique({
        where: { id: promptId },
        select: { usoTokensDia: true, usoDiaRef: true, usoTokensMes: true, usoMesRef: true },
      });
      if (!p) return;
      const { dia, mes } = this.dataRefs();
      await this.prisma.botPrompt.update({
        where: { id: promptId },
        data: {
          usoTokensDia: (p.usoDiaRef === dia ? p.usoTokensDia : 0) + tokens,
          usoDiaRef: dia,
          usoTokensMes: (p.usoMesRef === mes ? p.usoTokensMes : 0) + tokens,
          usoMesRef: mes,
        },
      });
    } catch {
      /* best-effort */
    }
  }

  private async montarHistorico(conversationId: string): Promise<HistoricoMsg[]> {
    // Inclui TODOS os tipos (não só TEXT): áudio transcrito (tipo=AUDIO) carrega
    // a resposta do lead no conteudo. Filtrar só TEXT fazia a IA esquecer as
    // respostas em áudio e re-perguntar tudo na entrevista.
    const msgs = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { criadoEm: 'desc' },
      take: HISTORICO_MAX,
      select: { direction: true, conteudo: true, criadoEm: true },
    });
    return msgs.reverse().map((m) => ({
      role: m.direction === MessageDirection.INBOUND ? ('user' as const) : ('assistant' as const),
      content: m.conteudo,
      at: m.criadoEm.getTime(),
    }));
  }

  /**
   * Enfileira os sucessores do nó pela aresta de `label` (ex: 'classificou' /
   * 'timeout'). `incluirSemLabel` cobre nós antigos de UMA saída só (aresta sem
   * label) — compat do ramo "classificou". Sem sucessores → execução concluída.
   */
  private async enfileirarSucessores(
    execucaoId: string,
    noId: string,
    label: string,
    incluirSemLabel: boolean,
  ): Promise<void> {
    const arestas = await this.prisma.fluxoEdge.findMany({ where: { sourceNoId: noId } });
    const alvos = arestas.filter((e) => e.label === label || (incluirSemLabel && !e.label));
    if (alvos.length === 0) {
      await this.prisma.fluxoExecucao.update({
        where: { id: execucaoId },
        data: { status: 'CONCLUIDO', terminouEm: new Date() },
      });
      return;
    }
    for (const e of alvos) {
      await this.enfileirarStep(execucaoId, e.targetNoId);
    }
  }

  /** Enfileira um passo na fila BullMQ (mesmo padrão de opções do executor). */
  private async enfileirarStep(execucaoId: string, noId: string): Promise<void> {
    await this.queue.add(
      'step',
      { execucaoId, noId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    );
  }
}
