import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { FluxoNo, FluxoEdge } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { HttpClientService } from '@shared/http/http-client.service';
import { WhatsAppService } from '@integrations/whatsapp/whatsapp.service';
import { WhatsappPacingService } from '@shared/whatsapp-pacing/whatsapp-pacing.service';
import {
  ForaDaJanelaEnvioError,
  INBOUND_RECENTE_HORAS,
} from '@shared/whatsapp-pacing/whatsapp-pacing.util';
import type { DestinatarioModo, Remetente } from './remetente-whatsapp.util';
import { resolverRemetente } from './remetente-whatsapp.util';
import { SupressaoService } from '@shared/supressao/supressao.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';
import { IntegracaoStatusService } from '@modules/integracoes/integracao-status.service';
import { KanbanTarefaService } from '@modules/kanban/kanban-tarefa.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { Prisma } from '@prisma/client';
import { safeRequest, SsrfBlockedError } from '@shared/utils/safe-request';
import { interpolate } from '@shared/utils/interpolate';
import { registrarTransicaoEtapa } from '@modules/leads/lead-etapa-historico.util';
import {
  type CtwaReferral,
  atribuicaoDeReferral,
  campanhaDoReferral,
} from '@integrations/evolution/ctwa-referral.util';
import { ConversarIaService } from './conversar-ia.service';
import { FluxoEventBusService } from './fluxo-event-bus.service';
// Mesma normalização usada pelo match de etiqueta no bus — mora num util pra
// os dois caminhos não divergirem (a IA solta "Nao e lead"/"Não é lead"
// indistintamente; um acento a menos desviava tudo pro ramo errado).
import { normalizarValor } from './normalizar-valor.util';
import {
  FLUXO_QUEUE,
  unidadeTempoMs,
  type FluxoStepJobData,
  type DelayConfig,
  type UnidadeTempo,
  type CondicaoConfig,
  type EnviarWhatsappConfig,
  type EnviarEmailConfig,
  type CriarTarefaConfig,
  type MudarTagConfig,
  type MoverLeadEtapaConfig,
  type CriarLeadConfig,
  type TransferirAtendimentoConfig,
  type PausarIaConfig,
  type AtribuirRepConfig,
  type WebhookExternoConfig,
  type LiberarLoteConfig,
  type ExecucaoContexto,
  SINAIS_ROTEAMENTO,
} from './fluxo-executor.types';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Papéis válidos pra destinatário "papel:<ROLE>" do ENVIAR_EMAIL (evita enum inválido no Prisma). */
const PAPEIS_VALIDOS = new Set(['ADMIN', 'DIRECTOR', 'GERENTE', 'SAC', 'REP']);

// Saídas EVENT-DRIVEN do CONVERSAR_IA (classify no retomar, timeout no cron, erro via `roteado`) —
// nunca seguidas na conclusão normal do passo. #17.
const SAIDAS_RESERVADAS_IA = new Set(['classificou', 'timeout', 'erro']);

// Teto de passos por execução (anti-loop, #18). Um fluxo legítimo — mesmo longo, com vários DELAY e
// bifurcações — não chega perto disto; um ciclo de ações (A→B→A sem DELAY) estouraria em segundos.
const MAX_PASSOS_POR_EXECUCAO = 500;

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

/**
 * Quanto tempo depois da última mensagem DO LEAD a conversa ainda conta como
 * "viva" — e portanto o que o fluxo manda é resposta, não abordagem.
 *
 * 4h é folgado de propósito. O caso que isto existe pra cobrir é o handoff
 * T1 → C1, que leva SEGUNDOS; a folga é pra conversa em andamento com pausa
 * humana no meio (a pessoa saiu, voltou). E qualquer mensagem nova do lead
 * reinicia a contagem, então conversa realmente ativa nunca expira.
 *
 * Não pode ser 24h: quem escreveu de manhã e recebe fluxo às 23h NÃO está do
 * outro lado, e aí a janela tem que valer.
 */
const INBOUND_RECENTE_MS = INBOUND_RECENTE_HORAS * 60 * 60 * 1000;

/** Converte unidade de delay para milissegundos (segundos/minutos/horas/dias). */
function delayParaMs(valor: number, unidade: UnidadeTempo): number {
  return unidadeTempoMs(valor, unidade);
}

/**
 * Resolve a variável do roteador tentando o nome cru, depois `custom.<v>` e
 * `conversa.<v>` (a IA grava em uma dessas, dependendo do escopo).
 */
function resolveVariavel(nome: string, ctx: ExecucaoContexto): string {
  const raw = resolveCampoFresco(nome, ctx);
  return raw != null ? String(raw) : '';
}

/**
 * Resolve um campo priorizando a cópia FRESCA (`custom.*`/`conversa.*`, remontada
 * do lead a cada passo) ANTES do atalho no topo do contexto — que pode ter ficado
 * VELHO (espelho achatado de um turno/execução anterior persistido no contexto).
 * Sem isto, roteador/condição liam o rótulo velho (ex: classificacao_final="LGPD"
 * de um teste anterior) em vez do novo do turno atual.
 */
function resolveCampoFresco(nome: string, ctx: ExecucaoContexto): unknown {
  return (
    resolveField(`custom.${nome}`, ctx) ??
    resolveField(`conversa.${nome}`, ctx) ??
    resolveField(nome, ctx)
  );
}

/**
 * Avalia o nó CONDICAO e devolve o LABEL da aresta a seguir.
 * - modo 'roteador': casa o valor da `variavel` com uma das `saidas` (label = valor) ou 'default'.
 * - modo 'simples' (default): 'true' | 'false'.
 */

function avaliarCondicao(config: CondicaoConfig, ctx: ExecucaoContexto): string {
  if (config.modo === 'roteador') {
    const norm = normalizarValor;
    const valor = norm(resolveVariavel(config.variavel ?? '', ctx));
    const match = (config.saidas ?? []).find((s) => norm(s) === valor);
    return match ?? 'default';
  }
  // Fresco (custom antes do topo) — mesma razão do roteador: o lgpd_c lia o
  // pedido_remocao VELHO do espelho achatado e roteava LGPD errado.
  const val = resolveCampoFresco(config.campo ?? '', ctx);
  const ref = config.valor;
  let resultado: boolean;
  // eq/neq/contains comparam TEXTO normalizado (mesma regra do roteador): a IA
  // grava "Não" e o config tem "Nao" (ou vice-versa) — comparação crua mandava o
  // lead pro ramo errado sem erro nenhum. gt/lt/gte/lte seguem numéricos.
  const ehTextoDosDoisLados = typeof ref !== 'number' && typeof ref !== 'boolean';
  const valTxt = normalizarValor(String(val ?? ''));
  const refTxt = normalizarValor(String(ref ?? ''));
  switch (config.operador) {
    case 'eq':
      resultado = ehTextoDosDoisLados ? valTxt === refTxt : val == ref;
      break;
    case 'neq':
      resultado = ehTextoDosDoisLados ? valTxt !== refTxt : val != ref;
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
      resultado = valTxt.includes(refTxt);
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
    private readonly pacing: WhatsappPacingService,
    private readonly integracaoStatus: IntegracaoStatusService,
    @InjectQueue(FLUXO_QUEUE) private readonly queue: Queue<FluxoStepJobData>,
    private readonly kanbanTarefa: KanbanTarefaService,
    private readonly supressao: SupressaoService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  /**
   * Executa um passo da execução (chamado pelo BullMQ Processor).
   */
  async executarPasso(execucaoId: string, noId: string, jobId: string): Promise<void> {
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

    // CAÇADA-BUG #18: guarda anti-loop. Um ciclo de ações no grafo (A→B→A sem DELAY) passa na
    // validação e rodaria pra SEMPRE, mandando mensagem real a cada volta (só o pacing segura). Como
    // cada passo grava 1 FluxoExecucaoLog, o total de logs = passos executados. Acima do teto, aborta
    // ANTES do claim/efeito (não envia mais nada) e marca FALHOU. Fluxo legítimo nunca chega perto.
    const passosExecutados = await this.prisma.fluxoExecucaoLog.count({ where: { execucaoId } });
    if (passosExecutados >= MAX_PASSOS_POR_EXECUCAO) {
      this.logger.error(
        `Execução ${execucaoId} atingiu ${passosExecutados} passos (teto ${MAX_PASSOS_POR_EXECUCAO}) — possível loop cíclico, abortando`,
      );
      await this.marcarFalhou(
        execucaoId,
        `Possível loop: ${passosExecutados} passos executados (teto ${MAX_PASSOS_POR_EXECUCAO})`,
      );
      return;
    }

    // IDEMPOTÊNCIA (cluster #1 auditoria): claim por job.id ANTES de qualquer efeito.
    // CONCLUIDO = efeito consumado → pula tudo (retry pós-efeito não re-executa).
    // EXECUTANDO = attempt anterior do MESMO job não chegou a CONCLUIDO — pode ter sido
    //   falha ANTES do efeito (re-executar é o certo) OU crash DEPOIS do efeito mas antes
    //   do commit do CONCLUIDO. Esses dois casos são indistinguíveis aqui (Dois Generais),
    //   então re-executamos — e a duplicação visível ao usuário é evitada pela CHAVE DE
    //   IDEMPOTÊNCIA que cada efeito externo carrega (idemBase=fx:<jobId>): o reenvio leva a
    //   mesma chave e o provider deduplica (Resend nativo / gate Redis na Evolution) → o
    //   destinatário NÃO recebe 2×. jobId é estável no retry e fresco a cada enqueue, então
    //   loops cíclicos e re-entrada do CONVERSAR_IA por turno não são suprimidos.
    try {
      await this.prisma.fluxoStepClaim.create({ data: { jobId, execucaoId, noId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const claim = await this.prisma.fluxoStepClaim.findUnique({ where: { jobId } });
        if (claim?.estado === 'CONCLUIDO') {
          this.logger.warn(`Passo job ${jobId} já concluído — skip idempotente`);
          return; // efeito já consumado neste job.id; nada a re-disparar
        }
        // EXECUTANDO: re-executa; o efeito é idempotente pela chave (dedup no provider).
        this.logger.warn(`Passo job ${jobId} retomando após falha (claim EXECUTANDO)`);
      } else {
        throw e; // Postgres fora etc.: falha antes do efeito → retry limpo, sem efeito
      }
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

    // JANELA DE ENVIO: nó que fala com o lead por WhatsApp de forma PROATIVA
    // (disparo do fluxo, não resposta a quem escreveu) não sai de madrugada —
    // volta pra fila com delay até a janela abrir. O `DELAY` do motor é cego pra
    // relógio de parede: um "espere 3h" disparado às 21h cai à 0h, e ninguém
    // percebe até o lead reclamar.
    //
    // REAGENDA, não espera: a pausa pode ser de 10 horas. Um `await` aqui
    // prenderia um dos 5 slots de concorrência do worker a noite inteira, e
    // sumiria no primeiro redeploy — a execução ficaria EM_EXECUCAO pra sempre.
    // Job com delay vive no Redis e sobrevive a deploy.
    // Nem todo envio de fluxo é abordagem. O que decide NÃO é o gatilho: é se tem
    // alguém do outro lado AGORA.
    //
    // A primeira versão disto olhava só o gatilho (MENSAGEM_CANAL/LEAD_RESPONDEU
    // = resposta) e furou no handoff entre fluxos: o T1 responde por
    // MENSAGEM_CANAL, classifica, move o lead de etapa — e o C1, que dispara por
    // LEAD_ETAPA_MUDOU, era tratado como abordagem. Resultado às 22h: a pessoa
    // acabava de responder a triagem e levava 10 horas de silêncio, que é
    // exatamente o dano que a regra existia pra evitar, entrando por outra porta.
    // O C1 não é abordagem: é a MESMA conversa, dois segundos depois.
    //
    // Então o gatilho vira só atalho, e o critério de verdade é a conversa viva.
    // Falha FECHADO: sem inbound recente, é abordagem e espera.
    let ehResposta = false;
    if (
      no.tipo === 'ACAO' &&
      (no.acaoTipo === 'ENVIAR_WHATSAPP' || no.acaoTipo === 'CONVERSAR_IA')
    ) {
      const fluxo = await this.prisma.fluxo.findUnique({
        where: { id: execucao.fluxoId },
        select: { triggerTipo: true },
      });
      ehResposta =
        fluxo?.triggerTipo === 'MENSAGEM_CANAL' ||
        fluxo?.triggerTipo === 'LEAD_RESPONDEU' ||
        (await this.conversaViva(
          execucao.empresaId,
          (execucao.contexto as ExecucaoContexto | null)?.['leadId'] as string | undefined,
        ));
      const esperaJanela = ehResposta
        ? 0
        : await this.pacing.esperaAntesDoProativoMs(execucao.empresaId).catch(() => 0);
      if (esperaJanela > 0) {
        // Solta o claim ANTES de reenfileirar: o job novo tem jobId próprio, e
        // deixar este como EXECUTANDO só daria trabalho ao reaper depois.
        await this.prisma.fluxoStepClaim.delete({ where: { jobId } }).catch(() => undefined);
        await this.queue.add(
          'step',
          { execucaoId, noId },
          {
            delay: esperaJanela,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { count: 500 },
            removeOnFail: { count: 200 },
          },
        );
        this.logger.log(
          `Execução ${execucaoId} nó ${noId} (${no.acaoTipo}) adiado ${Math.round(
            esperaJanela / 60000,
          )} min — fora da janela de envio`,
        );
        return;
      }
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
        const r = await this.conversarIa.iniciar(
          execucaoId,
          no,
          contexto,
          execucao.empresaId,
          ehResposta,
        );
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
        // idemBase = chave determinística ESTÁVEL ao passo lógico (execucaoId:noId, não jobId):
        // desce até cada efeito externo (WhatsApp/email/webhook/tarefa) pra dedup no provider.
        // Estável ao passo pra que um retry de dead-letter (jobId NOVO, mesmo passo) caia na
        // mesma chave → a dedup do provider evita reenvio dentro da janela (Resend 24h / gate).
        //
        // AUDITORIA (média): a chave não distinguia PASSADAS. Num fluxo com laço
        // (o lead volta pro mesmo nó de ENVIAR_WHATSAPP), a 2ª passada gerava a
        // MESMA chave e o gate do provider (TTL 24h) SUPRIMIA o envio — o passo
        // fechava verde, com "suprimido por idempotência" no log do adapter, e a
        // mensagem simplesmente não saía. Discriminador = quantas vezes este nó
        // JÁ CONCLUIU nesta execução. Retry de falha não conta (o log de falha
        // não é CONCLUIDO), então a chave do retry continua idêntica — que é
        // exatamente o que a dedup de retry precisa.
        const passada = await this.prisma.fluxoExecucaoLog.count({
          where: { execucaoId, noId, status: 'CONCLUIDO' },
        });
        output = await this.executarNo(
          no,
          contexto,
          execucao.empresaId,
          `fx:${execucaoId}:${noId}:p${passada}`,
          execucaoId,
          ehResposta,
        );
      }
    } catch (err) {
      // Janela/teto batendo no ÚLTIMO instante (a checagem lá em cima passou, e
      // entre ela e o envio o horário virou ou a cota do dia acabou numa corrida
      // com outro worker). Não é falha do nó: reagenda igual ao caminho de cima,
      // em vez de deixar o BullMQ tentar 3× em 2s e marcar a execução FALHOU.
      if (err instanceof ForaDaJanelaEnvioError) {
        await this.prisma.fluxoStepClaim.delete({ where: { jobId } }).catch(() => undefined);
        await this.queue.add(
          'step',
          { execucaoId, noId },
          {
            delay: err.esperaMs,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { count: 500 },
            removeOnFail: { count: 200 },
          },
        );
        this.logger.log(
          `Execução ${execucaoId} nó ${noId} adiado ${Math.round(err.esperaMs / 60000)} min ` +
            `(${err.motivo}) — corrida na borda do gate`,
        );
        return;
      }
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
    const logData = {
      execucaoId,
      noId,
      noTitulo: no.titulo,
      status: logStatus,
      input: toJsonInput(contexto),
      output: output ? toJsonInput(output) : Prisma.JsonNull,
      erroMsg: erroMsg ?? undefined,
      iniciadoEm,
      terminadoEm: new Date(),
    };
    if (logStatus === 'CONCLUIDO') {
      // Marca o claim CONCLUIDO JUNTO com o log: qualquer throw DEPOIS daqui (update da
      // execução / queue.add dos sucessores) faz o BullMQ re-rodar o job, que acha o claim
      // CONCLUIDO no topo e pula o efeito — sem duplicar WhatsApp/email/opener.
      await this.prisma.$transaction([
        this.prisma.fluxoExecucaoLog.create({ data: logData }),
        this.prisma.fluxoStepClaim.update({
          where: { jobId },
          data: { estado: 'CONCLUIDO', concluidoEm: new Date() },
        }),
      ]);
    } else {
      // FALHOU: claim fica EXECUTANDO → o throw abaixo dispara retry, que reentra no
      // claim EXECUTANDO e re-executa o efeito (falha real é re-tentada).
      await this.prisma.fluxoExecucaoLog.create({ data: logData });
    }

    if (!sucesso) {
      // Nó falhou — lança para o BullMQ re-tentar
      throw new Error(`Nó "${no.titulo}" falhou: ${erroMsg}`);
    }

    // Nó "Conversar com IA" esperando resposta do lead: pausa aqui (a retomada
    // acontece em LEAD_RESPONDEU, via ConversarIaService.retomar).
    if (aguardando) {
      // Opener já enviado e claim já marcado CONCLUIDO (transação acima, sucesso && !roteado):
      // um retry do job 'step' NÃO re-gera a IA nem re-envia o opener.
      this.logger.debug(`Execução ${execucaoId} pausada (Conversar com IA aguardando lead)`);
      return;
    }

    // Nó "Conversar com IA" roteou pela saída "erro": a execução já foi atualizada
    // e o ramo "erro" enfileirado pelo ConversarIaService. Não segue o caminho
    // normal nem encerra aqui.
    if (roteado) {
      // CONVERSAR_IA já enviou/roteou e NÃO relança (sem retry). Marca o claim CONCLUIDO
      // pra não deixar órfão EXECUTANDO (best-effort: o job já terminou, não relança).
      await this.prisma.fluxoStepClaim
        .update({ where: { jobId }, data: { estado: 'CONCLUIDO', concluidoEm: new Date() } })
        .catch(() => undefined);
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

    // Alias do CONDICAO simples: o editor grava 'Sim'/'Não', mas fluxo importado
    // (MCP/JSON) pode vir com 'true'/'false' ou sem acento — sem o alias nenhum
    // ramo casava e a execução concluía VERDE sem executar nada. NÃO vale pro
    // modo roteador (lá o label é o valor literal da saída, ex.: 'sim, quero').
    const condicaoSimples =
      no.tipo === 'CONDICAO' && (no.config as unknown as CondicaoConfig).modo !== 'roteador';
    const casaLabel = (label: string | null): boolean => {
      if (labelParaNavegar === null) return true;
      if (label === labelParaNavegar) return true;
      if (!condicaoSimples || !label) return false;
      const n = label
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '');
      return labelParaNavegar === 'Sim'
        ? n === 'sim' || n === 'true'
        : n === 'nao' || n === 'false';
    };

    const proximosNoIds = arestas
      .filter((e: FluxoEdge) => e.sourceNoId === noId)
      .filter((e: FluxoEdge) => {
        // CAÇADA-BUG #17: as saídas 'classificou'/'timeout'/'erro' do CONVERSAR_IA são EVENT-DRIVEN
        // (classify no retomar, timeout no cron, erro via `roteado`) — NÃO fazem parte da conclusão
        // normal do passo. Quando o nó conclui sem aguardar/rotear/pular (ex.: aguardarResposta=false),
        // caía aqui com label=null e seguia TODAS as arestas, disparando os 3 ramos de uma vez. Na
        // conclusão normal, o CONVERSAR_IA só pode seguir a saída MAIN (sem label reservado).
        if (no.acaoTipo === 'CONVERSAR_IA') {
          return !e.label || !SAIDAS_RESERVADAS_IA.has(e.label);
        }
        return casaLabel(e.label);
      })
      .map((e: FluxoEdge) => e.targetNoId);

    if (proximosNoIds.length === 0) {
      // REDE DE SEGURANÇA: condição que TEM saídas mas nenhuma casou com o
      // rótulo emitido não é "fim de caminho" — é grafo quebrado (label errado
      // vindo de import/MCP, saída renomeada sem religar a aresta). Antes isso
      // concluía VERDE sem executar nada: a falha mais silenciosa do sistema.
      if (no.tipo === 'CONDICAO' && labelParaNavegar !== null) {
        const saindo = arestas.filter((e: FluxoEdge) => e.sourceNoId === noId);
        if (saindo.length > 0) {
          const rotulos = saindo.map((e: FluxoEdge) => e.label ?? '(sem rótulo)').join(', ');
          await this.marcarFalhou(
            execucaoId,
            `Condição "${no.titulo}" resultou em "${labelParaNavegar}", mas nenhuma conexão tem esse rótulo (existentes: ${rotulos}). O fluxo parou aqui.`,
          );
          return;
        }
      }
      // Execução do CRON que terminou SEM efeito (ex: LIBERAR_LOTE com 0 leads
      // elegíveis): descarta o registro (cascade nos logs) pra não poluir o
      // histórico com execuções vazias a cada minuto. Disparos manuais e
      // execuções que fizeram algo seguem registradas normalmente.
      const semEfeito = (output as { semEfeito?: boolean } | null)?.semEfeito === true;
      const doCron = (execucao.contexto as { _cron?: boolean } | null)?._cron === true;
      if (semEfeito && doCron) {
        await this.prisma.fluxoExecucao.delete({ where: { id: execucaoId } }).catch(() => {
          /* já removida / corrida — ignora */
        });
        this.logger.debug(`Execução ${execucaoId} descartada (cron sem efeito — nada a fazer)`);
        return;
      }
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
        // O front grava `quantidade`; `valor` é compat legada. Default de unidade = 'minutos'
        // (igual ao DelayForm) — antes lia só `valor` (sempre undefined → 1), então todo DELAY
        // virava "1 hora" independente do que foi configurado.
        delayMs = delayParaMs(cfg.quantidade ?? cfg.valor ?? 1, cfg.unidade ?? 'minutos');
        // Rede de segurança: config corrompida (NaN/negativo) não deve virar delay inválido
        // na fila — cai em 0 (dispara já) em vez de travar o passo.
        if (!Number.isFinite(delayMs) || delayMs < 0) delayMs = 0;
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

  /**
   * Execução de teste que NÃO deve mandar mensagem de verdade.
   *
   * A marca viaja no contexto (`_teste` + `_testeEnviaDeVerdade`) porque é lá
   * que os nós de envio a enxergam, sem precisar recarregar a execução.
   */
  private testeSemEnvio(ctx: ExecucaoContexto): boolean {
    const c = ctx as Record<string, unknown>;
    return c['_teste'] === true && c['_testeEnviaDeVerdade'] !== true;
  }

  /**
   * Resolve — e VALIDA — de qual número a mensagem sai.
   *
   * A regra está no util puro; aqui entra o que precisa de banco/provider. A
   * validação só é exigida quando alguém ESCOLHEU o remetente: se o usuário não
   * é da empresa, ou o WhatsApp pessoal dele não está conectado, o passo FALHA
   * com o motivo. Nunca cai calado pro número da empresa — mandar do número
   * errado é pior que não mandar, porque ninguém percebe.
   *
   * No caminho automático (dono da conversa) não há o que validar: aquela
   * instância acabou de RECEBER a mensagem que originou a execução.
   */
  private async resolverRemetenteValidado(
    empresaId: string,
    cfg: { remetenteUsuarioId?: string; destinatarioModo?: DestinatarioModo },
    ctx: ExecucaoContexto,
  ): Promise<Remetente> {
    const r = resolverRemetente({
      configurado: cfg.remetenteUsuarioId,
      donoDaConversa: (ctx as Record<string, unknown>)['proprietarioId'] as string | undefined,
      modo: cfg.destinatarioModo ?? 'lead',
    });
    if (r.origem !== 'configurado' || !r.proprietarioId) return r;

    const usuario = await this.prisma.usuario.findFirst({
      where: { id: r.proprietarioId, empresas: { some: { empresaId } } },
      select: { id: true, nome: true },
    });
    if (!usuario) {
      throw new Error(
        `Remetente inválido: usuário ${r.proprietarioId} não pertence a esta empresa. ` +
          'Nada foi enviado.',
      );
    }
    const disponivel = await this.whatsapp.estaDisponivel(empresaId, r.proprietarioId);
    if (!disponivel) {
      throw new Error(
        `WhatsApp pessoal de ${usuario.nome} não está conectado — o envio NÃO saiu pelo número ` +
          'da empresa de propósito (sairia do remetente errado). Conecte em Integrações e repita.',
      );
    }
    return r;
  }

  /**
   * Tem alguém do outro lado agora? Ou seja: o lead mandou mensagem há pouco.
   *
   * `Lead.ultimaMensagemEm` é carimbado a cada mensagem RECEBIDA do lead (e em
   * todos os ids irmãos, quando a pessoa tem lead duplicado), então já é o sinal
   * exato — sem inventar tabela nem varrer a inbox.
   *
   * Falha FECHADO de propósito: sem leadId, sem carimbo ou com o banco fora, a
   * resposta é "não". O custo de errar pra cá é uma mensagem legítima sair mais
   * tarde; errar pro outro lado é acordar alguém às 3h.
   */
  private async conversaViva(empresaId: string, leadId?: string): Promise<boolean> {
    if (!leadId) return false;
    try {
      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, empresaId },
        select: { ultimaMensagemEm: true },
      });
      const ultima = lead?.ultimaMensagemEm?.getTime();
      return !!ultima && Date.now() - ultima <= INBOUND_RECENTE_MS;
    } catch {
      return false;
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
            // Porta de entrada e formulário que converteu. Existiam no banco e
            // NUNCA chegavam ao contexto — então a CONDICAO não conseguia
            // separar "veio do orçamento industrial" de "veio do checkout NI",
            // e sobrava comparar `segmento`, que é texto livre. Texto livre em
            // condição é a mesma armadilha da etapa comparada por nome.
            origemCadastro: true,
            formularioOrigem: true,
            variaveis: true,
            funilId: true,
            funilEtapaId: true,
            // DONO da carteira. Existia no banco desde sempre e não chegava ao
            // contexto — então uma CONDICAO "esse lead tem rep?" não tinha em
            // que campo bater. E não dava erro: comparava contra vazio e seguia
            // pelo ramo errado EM SILÊNCIO. Num fluxo de reabordagem isso vira
            // o bot mandando mensagem pro cliente de quem está negociando.
            representanteId: true,
            representante: { select: { nome: true } },
            // Há quanto tempo parado na etapa (vira `dias_na_etapa`).
            etapaDesde: true,
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
            // Estáveis pra CONDICAO: valores de vocabulário controlado
            // (site|meta_lead_ads|…, contato|calculadora|seletor|…), não texto
            // digitado. Use ESTES pra rotear por origem — nunca `segmento`.
            origem: lead.origemCadastro ?? '',
            formulario: lead.formularioOrigem ?? '',
            etapa_atual: lead.funilEtapa?.nome ?? lead.etapa,
            // IDs pra CONDICAO comparar de forma ESTÁVEL. `etapa_atual`/`funil`
            // são NOME e quebram silenciosamente quando alguém renomeia a etapa
            // (a condição só deixa de casar e o fluxo segue pelo ramo errado).
            // Em condição, use SEMPRE `lead.etapa_id`; o nome fica pra template.
            etapa_id: lead.funilEtapaId ?? '',
            funil_id: lead.funilId ?? '',
            funil: lead.funil?.nome ?? '',
            // `representante_id` é o campo ESTÁVEL pra CONDICAO (mesma regra do
            // `etapa_id`): vazio = lead sem dono. `representante_nome` é pra
            // template — "o {{lead.representante_nome}} está com esse cliente".
            representante_id: lead.representanteId ?? '',
            representante_nome: lead.representante?.nome ?? '',
            // Dias parado na etapa atual (inteiro, arredondado pra baixo).
            // Permite condição "parado há mais de N dias" sem cron próprio.
            dias_na_etapa: Math.floor(
              (Date.now() - new Date(lead.etapaDesde).getTime()) / 86_400_000,
            ),
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

    // ATALHOS no TOPO do contexto: o usuário escreve {{nome}}, {{cidade}}, {{uf}},
    // {{whatsapp}}, {{canal_dominante}}, {{observacao_executiva}}… SEM prefixo (não
    // {{lead.nome}}/{{custom.x}}). Expomos os campos do lead + os defaults da empresa +
    // as variáveis CAPTURADAS pela IA (Lead.variaveis) direto no topo, pra esses nomes
    // resolverem na interpolação. Precedência: variáveis capturadas > defaults > campos
    // do lead. NÃO sobrescreve chaves que o evento já trouxe (leadId, clienteId, texto…).
    // leadVars (variáveis CAPTURADAS pela IA) = estado ATUAL do lead → SEMPRE
    // sobrescrevem o atalho no topo. Antes o `if (ctx[k] === undefined)` deixava
    // um valor VELHO (achatado num turno/execução anterior e persistido no
    // contexto) mascarar o novo → o roteador lia classificacao_final="LGPD"
    // velho em vez do "Sem Sinergia" fresco. leadVars não colide com chaves de
    // evento (leadId/texto/…), então sobrescrever é seguro.
    for (const [k, v] of Object.entries(leadVars)) {
      if (v != null) ctx[k] = v;
    }
    // Cauda do espelho velho: sinal de roteamento LIMPO do lead (limparSinais-
    // Roteamento) some do leadVars — mas o atalho achatado numa execução ANTERIOR
    // ainda vive no contexto persistido e voltaria a rotear ("removido" viraria
    // "sem sinal novo" e o fallback lia o velho). Remove o espelho órfão.
    for (const k of SINAIS_ROTEAMENTO) {
      // 'classificacao' também é payload de EVENTO (IA_CLASSIFICOU) — não é só espelho.
      if (k === 'classificacao') continue;
      if (!(k in leadVars)) delete ctx[k];
    }
    // Campos do lead + defaults da empresa: só preenchem quando AUSENTES (não
    // clobber o que o evento já trouxe).
    const atalhos: Record<string, unknown> = {
      ...(ctx.lead as Record<string, unknown> | undefined),
      ...defaults,
    };
    for (const [k, v] of Object.entries(atalhos)) {
      // `v != null` deixa string vazia passar (campo vazio → renderiza em branco, não
      // o literal {{x}}); só pula null/undefined.
      if (ctx[k] === undefined && v != null) ctx[k] = v;
    }

    if (ctx.lead == null) ctx.lead = {};

    return ctx;
  }

  // ─── Executor de nó ─────────────────────────────────────────────────

  private async executarNo(
    no: FluxoNo,
    ctx: ExecucaoContexto,
    empresaId: string,
    idemBase: string,
    execucaoId: string,
    /** Fluxo disparado por mensagem do lead → o que ele manda é RESPOSTA. */
    reativo = false,
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
        return this.executarAcao(no, ctx, empresaId, idemBase, execucaoId, reativo);

      default:
        return {};
    }
  }

  private async executarAcao(
    no: FluxoNo,
    ctx: ExecucaoContexto,
    empresaId: string,
    idemBase: string,
    execucaoId: string,
    reativo = false,
  ): Promise<Record<string, unknown>> {
    const acaoTipo = no.acaoTipo;
    if (!acaoTipo) throw new Error(`Nó ACAO sem acaoTipo definido`);

    const cfg = no.config as unknown;
    switch (acaoTipo) {
      case 'ENVIAR_WHATSAPP':
        return this.acaoEnviarWhatsapp(
          cfg as EnviarWhatsappConfig,
          ctx,
          empresaId,
          idemBase,
          reativo,
        );

      case 'ENVIAR_EMAIL':
        return this.acaoEnviarEmail(cfg as EnviarEmailConfig, ctx, empresaId, idemBase);

      case 'CRIAR_TAREFA':
        return this.acaoCriarTarefa(cfg as CriarTarefaConfig, ctx, empresaId, idemBase);

      case 'MUDAR_TAG':
        return this.acaoMudarTag(cfg as MudarTagConfig, ctx, empresaId);

      case 'MOVER_LEAD_ETAPA':
        return this.acaoMoverLeadEtapa(cfg as MoverLeadEtapaConfig, ctx, empresaId);

      case 'ATRIBUIR_REP':
        return this.acaoAtribuirRep(cfg as AtribuirRepConfig, ctx, empresaId);

      case 'WEBHOOK_EXTERNO':
        return this.acaoWebhookExterno(cfg as WebhookExternoConfig, ctx, idemBase);

      case 'LIBERAR_LOTE':
        return this.acaoLiberarLote(cfg as LiberarLoteConfig, empresaId);

      case 'PAUSAR_IA':
        return this.acaoPausarIa(cfg as PausarIaConfig, ctx, empresaId);

      case 'CRIAR_LEAD':
        return this.acaoCriarLead(cfg as CriarLeadConfig, ctx, empresaId, execucaoId);

      case 'TRANSFERIR_ATENDIMENTO':
        return this.acaoTransferirAtendimento(cfg as TransferirAtendimentoConfig, ctx, empresaId);

      default:
        throw new Error(`Tipo de ação desconhecido: ${acaoTipo}`);
    }
  }

  // ─── Ações concretas ────────────────────────────────────────────────

  private async acaoEnviarWhatsapp(
    cfg: EnviarWhatsappConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
    idemBase: string,
    /**
     * Fluxo disparado por mensagem do lead. Muda duas coisas: usa a faixa RÁPIDA
     * de pacing (responder quem chamou não é rajada) e dispensa a janela de
     * envio — a janela já foi conferida no passo, e resposta não tem horário.
     */
    reativo = false,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'ENVIAR_WHATSAPP');
    const mensagem = interpolate(cfg.mensagem, ctx);
    const modo = cfg.destinatarioModo ?? 'lead';

    // Supressão LGPD: se o destino é o PRÓPRIO lead (modo 'lead') e ele tem a tag
    // "Não Reabordar - LGPD ⛔", NÃO envia. Avisos pra grupo/número fixo (modo
    // 'contato'/'numero', ex.: diretoria) NÃO são suprimidos — a supressão é sobre
    // CONTATAR o suprimido, não sobre falar dele internamente.
    let telefoneLeadResolvido: string | undefined;
    if (modo === 'lead') {
      // Telefone resolvido ANTES da checagem: a supressão também casa por SUFIXO
      // (D18) — pega lead DUPLICADO (mesma pessoa, outro leadId) em que só a
      // outra cópia tem a tag. Reusado abaixo no envio (sem query dupla).
      telefoneLeadResolvido = await this.resolverTelefoneLeadOuCliente(ctx, empresaId);
      const suprimido = await this.supressao.suprimido(empresaId, {
        leadId: ctx['leadId'] as string | undefined,
        clienteId: ctx['clienteId'] as string | undefined,
        telefone: telefoneLeadResolvido,
      });
      if (suprimido) {
        this.logger.log('ENVIAR_WHATSAPP suprimido (LGPD) — modo lead');
        return { suprimido: true, motivo: 'LGPD', canal: 'whatsapp' };
      }
    }

    // MODO SECO do teste: execução de teste NÃO manda mensagem pra pessoa, a não
    // ser que quem testou tenha pedido explicitamente. Do outro lado da conversa
    // tem gente de verdade, e mensagem enviada não volta. O passo é registrado
    // com o texto que sairia — que é o que se quer conferir num teste.
    if (this.testeSemEnvio(ctx)) {
      return {
        simulado: true,
        motivo: 'Execução de TESTE — mensagem não enviada (marque "enviar de verdade" pra enviar)',
        modo,
        mensagem,
        ...(cfg.midia?.storagePath ? { midia: cfg.midia.tipo } : {}),
      };
    }

    // De qual NÚMERO sai. Validado antes do pacing: se o remetente escolhido não
    // serve, o passo falha aqui, sem gastar slot nem cota do dia.
    const remetente = await this.resolverRemetenteValidado(empresaId, cfg, ctx);
    const ctxEnvio = {
      idempotencyKey: idemBase,
      ...(remetente.proprietarioId ? { proprietarioId: remetente.proprietarioId } : {}),
    };

    // Pacing global: espaça este envio dos demais da empresa (anti-rajada).
    await this.pacing.aguardarSlot(empresaId, reativo);

    // Envio: se há anexo (midia), manda mídia com a `mensagem` como legenda; senão, texto.
    // Único ponto de envio (reusado pelo caminho de grupo e pelo de telefone).
    const enviar = async (peerId: string): Promise<Record<string, unknown>> => {
      try {
        if (cfg.midia?.storagePath) {
          const r = await this.whatsapp.enviarMidia(
            empresaId,
            peerId,
            {
              tipo: cfg.midia.tipo,
              storagePath: cfg.midia.storagePath,
              mimetype: cfg.midia.mimetype,
              fileName: cfg.midia.fileName,
              ptt: cfg.midia.ptt,
              caption: mensagem || undefined,
            },
            ctxEnvio,
          );
          return {
            peerId,
            modo,
            midia: cfg.midia.tipo,
            caption: mensagem,
            externalId: r.externalId,
            remetente: remetente.origem,
          };
        }
        const r = await this.whatsapp.enviarTexto(empresaId, peerId, mensagem, ctxEnvio);
        // `remetente` no output: sem isso, olhar o histórico não diz por qual
        // número a mensagem saiu — e é exatamente essa a dúvida quando o cliente
        // diz que recebeu de outro contato.
        return { peerId, modo, mensagem, externalId: r.externalId, remetente: remetente.origem };
      } catch (err) {
        // BL-1: se o envio falhou porque o WhatsApp da empresa está desconectado,
        // avisa o DIRETOR proativamente (senão o fluxo falha em silêncio e o dono
        // acha que "bugou"). Não muda o retry/dead-letter — só ADICIONA o alerta.
        await this.alertarSeWhatsappCaiu(empresaId, err);
        throw err;
      }
    };

    // GRUPO do WhatsApp: o "contato salvo" pode ser um grupo (jid @g.us). O jid é
    // o destino direto — NÃO normaliza pra telefone (senão viraria um número
    // solto). O adapter (Baileys/Evolution) aceita o jid de grupo como remoteJid.
    if (modo === 'contato') {
      const alvo = (cfg.destinatarioContato ?? '').trim();
      if (alvo.endsWith('@g.us')) return enviar(alvo);
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
      // Já resolvido no gate de supressão acima — não repete a query.
      telefone =
        telefoneLeadResolvido ?? (await this.resolverTelefoneLeadOuCliente(ctx, empresaId));
      if (!telefone) {
        throw new Error('ENVIAR_WHATSAPP: contexto sem lead/cliente com telefone (modo "lead")');
      }
    }
    if (telefone.replace(/\D/g, '').length < 8) {
      throw new Error(`ENVIAR_WHATSAPP: telefone do destinatário inválido (${telefone})`);
    }

    return enviar(`${telefone}@s.whatsapp.net`);
  }

  /**
   * BL-1 — alerta proativo de WhatsApp desconectado.
   *
   * Chamado quando um envio de WhatsApp do fluxo falha. Consulta o estado LOCAL
   * da instância Evolution (alimentado em tempo-real por webhook CONNECTION_UPDATE
   * + cron de 10min — SEM chamada extra à API). Só escala quando a instância
   * existe e NÃO está `open` (desconexão real / não pareado), evitando falso
   * alarme em falha transitória (número inválido, timeout pontual). O e-mail ao
   * diretor é throttled (1/h) e best-effort — nunca atrapalha o envio/retry.
   */
  private async alertarSeWhatsappCaiu(empresaId: string, err: unknown): Promise<void> {
    try {
      const inst = await this.prisma.evolutionInstancia.findUnique({
        where: { instanceName: `emp_${empresaId}` },
        select: { connectionStatus: true },
      });
      if (inst && inst.connectionStatus !== 'open') {
        const msg = err instanceof Error ? err.message : String(err);
        await this.integracaoStatus.marcarDesconectado(empresaId, 'whatsapp', msg);
      }
    } catch {
      /* best-effort: o alerta nunca pode quebrar o envio nem o retry do fluxo */
    }
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

  /** E-mail (lowercase) do lead/cliente do contexto — pra filtrar da supressão LGPD. */
  private async emailDoContato(
    empresaId: string,
    leadId?: string,
    clienteId?: string,
  ): Promise<string | undefined> {
    if (leadId) {
      const l = await this.prisma.lead.findFirst({
        where: { id: leadId, empresaId },
        select: { contatoEmail: true },
      });
      if (l?.contatoEmail) return l.contatoEmail.trim().toLowerCase();
    }
    if (clienteId) {
      const c = await this.prisma.cliente.findFirst({
        where: { id: clienteId, empresaId },
        select: { email: true },
      });
      if (c?.email) return c.email.trim().toLowerCase();
    }
    return undefined;
  }

  private async acaoEnviarEmail(
    cfg: EnviarEmailConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
    idemBase: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'ENVIAR_EMAIL');
    let emails = await this.resolverDestinatarios(cfg, ctx, empresaId);
    if (emails.length === 0) {
      throw new Error('Nenhum destinatário resolvido para ENVIAR_EMAIL');
    }

    // Supressão LGPD: se o lead/cliente do contexto tem a tag "Não Reabordar",
    // REMOVE o e-mail dele da lista (destinatários internos seguem recebendo).
    const leadIdSup = ctx['leadId'] as string | undefined;
    const clienteIdSup = ctx['clienteId'] as string | undefined;
    if (leadIdSup || clienteIdSup) {
      const suprimido = await this.supressao.suprimido(empresaId, {
        leadId: leadIdSup,
        clienteId: clienteIdSup,
      });
      if (suprimido) {
        const emailContato = await this.emailDoContato(empresaId, leadIdSup, clienteIdSup);
        if (emailContato) {
          const antes = emails.length;
          emails = emails.filter((e) => e.trim().toLowerCase() !== emailContato);
          if (emails.length < antes) {
            this.logger.log('ENVIAR_EMAIL: e-mail do contato suprimido (LGPD) removido da lista');
          }
        }
        if (emails.length === 0) {
          this.logger.log('ENVIAR_EMAIL suprimido (LGPD) — sem destinatário restante');
          return { suprimido: true, motivo: 'LGPD', canal: 'email' };
        }
      }
    }

    const assunto = interpolate(cfg.assunto, ctx);
    const corpo = interpolate(cfg.corpo, ctx);

    // MODO SECO do teste, mesma regra do WhatsApp: e-mail de teste chegaria na
    // caixa de uma pessoa real. O card falava de WhatsApp, mas deixar o e-mail
    // de fora seria uma inconsistência que morde na primeira leva de nutrição.
    if (this.testeSemEnvio(ctx)) {
      return {
        simulado: true,
        motivo: 'Execução de TESTE — e-mail não enviado (marque "enviar de verdade" pra enviar)',
        destinatarios: emails,
        assunto,
      };
    }

    // Resend sistêmico — envia 1 e-mail por destinatário resolvido. Chave de idempotência
    // por destinatário (Resend deduplica nativamente por 24h) → retry não duplica e-mail.
    const messageIds: string[] = [];
    for (const para of emails) {
      const r = await this.emailSvc.enviarHtmlLivre({
        para,
        assunto,
        html: corpo,
        idempotencyKey: `${idemBase}:${para}`,
        empresaId, // remetente por-tenant (Empresa.config.emailTransacional)
      });
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
      // Fluxo LEAD-driven: sem cliente, cai pro e-mail do lead (contatoEmail).
      if (emails.size === 0) {
        const leadId = ctx['leadId'] as string | undefined;
        if (leadId) {
          const l = await this.prisma.lead.findFirst({
            where: { id: leadId, empresaId },
            select: { contatoEmail: true },
          });
          if (l?.contatoEmail) emails.add(l.contatoEmail);
        }
      }
    }
    return [...emails];
  }

  private async acaoCriarTarefa(
    cfg: CriarTarefaConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
    idemBase: string,
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
    // Fluxo LEAD-driven: sem cliente, usa o rep do lead como responsável.
    if (!responsavelId) {
      const leadId = ctx['leadId'] as string | undefined;
      if (leadId) {
        const lead = await this.prisma.lead.findFirst({
          where: { id: leadId, empresaId },
          select: { representanteId: true },
        });
        responsavelId = lead?.representanteId ?? undefined;
      }
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

    // Idempotente por passo: retry pós-efeito (claim ainda EXECUTANDO) recriaria a tarefa.
    // origemJobId @unique = a chave determinística do passo (idemBase) → 2ª tentativa cai em
    // P2002 e adota a tarefa já criada, sem duplicar.
    try {
      const tarefa = await this.prisma.agendaItem.create({
        data: {
          empresaId,
          usuarioId: responsavelId,
          clienteId: clienteId ?? null,
          titulo,
          data,
          tipo: cfg.tipo ?? 'TAREFA',
          origemJobId: idemBase,
          ...(observacao ? { observacao } : {}),
        },
      });
      const cards = await this.criarCardsDeTarefa({
        empresaId,
        responsavelId,
        titulo,
        descricao: observacao,
        dataEntrega: data,
        origemJobId: idemBase,
      });
      return { tarefaId: tarefa.id, titulo, responsavelId, data: data.toISOString(), ...cards };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existente = await this.prisma.agendaItem.findFirst({
          where: { origemJobId: idemBase },
          select: { id: true },
        });
        // Retry pós-efeito: garante os cards mesmo que o AgendaItem já existisse
        // (a 1ª tentativa pode ter criado o AgendaItem e morrido antes dos cards).
        const cards = await this.criarCardsDeTarefa({
          empresaId,
          responsavelId,
          titulo,
          descricao: observacao,
          dataEntrega: data,
          origemJobId: idemBase,
        });
        return {
          tarefaId: existente?.id,
          titulo,
          responsavelId,
          data: data.toISOString(),
          idempotente: true,
          ...cards,
        };
      }
      throw err;
    }
  }

  /**
   * Ponte CRIAR_TAREFA → card(s) Kanban (quadro do rep + espelho no Diretor).
   * Dual-write com o AgendaItem, best-effort: NUNCA propaga exceção (a criação
   * da tarefa/agenda não pode falhar por causa da camada de visibilidade).
   */
  private async criarCardsDeTarefa(params: {
    empresaId: string;
    responsavelId: string;
    titulo: string;
    descricao?: string;
    dataEntrega: Date;
    origemJobId: string;
  }): Promise<Record<string, unknown>> {
    try {
      const r = await this.kanbanTarefa.criarCardsDeTarefa(params);
      return {
        repCardId: r.repCardId,
        diretorCardId: r.diretorCardId,
        ...(r.idempotente ? { cardIdempotente: true } : {}),
      };
    } catch (err) {
      this.logger.warn(
        `CRIAR_TAREFA: falha ao criar card Kanban (segue sem derrubar): ${String(err)}`,
      );
      return { cardErro: true };
    }
  }

  private async acaoMudarTag(
    cfg: MudarTagConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'MUDAR_TAG');
    const clienteId = ctx['clienteId'] as string | undefined;
    const leadId = ctx['leadId'] as string | undefined;
    // Fluxos podem ser CLIENTE-driven (clienteId) OU LEAD-driven (leadId, ex:
    // prospecção/"Lead mudou etapa"). Antes só tagueava cliente e quebrava no fluxo
    // de lead. Agora tagueia o que o contexto tiver (cliente via ClienteTag, lead
    // via LeadTag) — só falha se não houver nenhum dos dois.
    if (!clienteId && !leadId) {
      throw new Error('contexto sem clienteId nem leadId para MUDAR_TAG');
    }

    // Sprint 2: Tag tem empresaId (@@unique([empresaId, nome])). Upsert pela chave
    // composta — tags são scoped por tenant.
    // #B16: mesma normalização do TagsService.upsertByName — sem trim/teto, um
    // {{variavel}} interpolado com espaço ou texto longo criava etiqueta duplicada.
    const nomeTagLimpo = cfg.tagNome.trim().slice(0, 100);
    const tag = await this.prisma.tag.upsert({
      where: { empresaId_nome: { empresaId, nome: nomeTagLimpo } },
      create: { empresaId, nome: nomeTagLimpo },
      update: {},
    });
    const adicionar = cfg.operacao === 'adicionar';
    const alvos: string[] = [];

    if (clienteId) {
      // AUDITORIA 2026-05-15: exige cliente PERTENCER à empresa do fluxo.
      const clienteOk = await this.prisma.cliente.findFirst({
        where: { id: clienteId, empresaId },
        select: { id: true },
      });
      if (!clienteOk)
        throw new Error(`Cliente ${clienteId} não encontrado na empresa ${empresaId}`);
      if (adicionar) {
        await this.prisma.clienteTag.upsert({
          where: { clienteId_tagId: { clienteId, tagId: tag.id } },
          create: { clienteId, tagId: tag.id },
          update: {},
        });
      } else {
        await this.prisma.clienteTag.deleteMany({ where: { clienteId, tagId: tag.id } });
      }
      alvos.push('cliente');
    }

    if (leadId) {
      // Valida que o lead é da empresa do fluxo (mesma defesa cross-tenant).
      const leadOk = await this.prisma.lead.findFirst({
        where: { id: leadId, empresaId },
        select: { id: true },
      });
      if (!leadOk) throw new Error(`Lead ${leadId} não encontrado na empresa ${empresaId}`);
      if (adicionar) {
        await this.prisma.leadTag.upsert({
          where: { leadId_tagId: { leadId, tagId: tag.id } },
          create: { leadId, tagId: tag.id, origem: 'fluxo' },
          update: {},
        });
      } else {
        await this.prisma.leadTag.deleteMany({ where: { leadId, tagId: tag.id } });
      }
      alvos.push('lead');
    }

    return { tagId: tag.id, tagNome: cfg.tagNome, operacao: cfg.operacao, alvos };
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
      // Histórico: transição por FLUXO (só quando muda de verdade).
      if (origemId !== etapa.id) {
        await registrarTransicaoEtapa(this.prisma, this.logger, {
          empresaId,
          leadId,
          funilId: etapa.funilId,
          etapaOrigem: origemId ?? null,
          etapaDestino: etapa.id,
          quem: null,
          origemMudanca: 'fluxo',
        });
      }
      // Lead mudou de etapa → dispara LEAD_ETAPA_MUDOU pros fluxos da etapa destino
      // (ex: "Primeira Abordagem"), mesma semântica do LIBERAR_LOTE. Só quando a
      // etapa realmente muda, pra não disparar em re-move no-op nem criar laço.
      if (origemId !== etapa.id) {
        // Propaga _hops: este re-disparo é um elo de cadeia (corta-loop do FluxoEventBus).
        const hops = typeof ctx['_hops'] === 'number' ? (ctx['_hops'] as number) : 0;
        await this.bus.disparar(empresaId, 'LEAD_ETAPA_MUDOU', {
          leadId,
          funilId: etapa.funilId,
          deFunilEtapaId: origemId,
          paraFunilEtapaId: etapa.id,
          _hops: hops + 1,
        });
      }
      return { leadId, funilEtapaId: etapa.id };
    }

    // Fallback: enum legado.
    if (!cfg.etapa) throw new Error('MOVER_LEAD_ETAPA sem funilEtapaId nem etapa definidos');
    // Etapa de origem ANTES do move (pro histórico registrar a transição real).
    const antesLegado = await this.prisma.lead.findFirst({
      where: { id: leadId, empresaId },
      select: { etapa: true, funilId: true },
    });
    // AUDITORIA 2026-05-15: updateMany com empresaId no where evita write cross-tenant.
    const { count } = await this.prisma.lead.updateMany({
      where: { id: leadId, empresaId },
      data: { etapa: cfg.etapa, etapaDesde: new Date() },
    });
    if (count === 0) {
      throw new Error(`Lead ${leadId} não encontrado na empresa ${empresaId}`);
    }
    // Histórico: transição por FLUXO (enum legado). Só quando muda de verdade.
    if (antesLegado && antesLegado.etapa !== cfg.etapa) {
      await registrarTransicaoEtapa(this.prisma, this.logger, {
        empresaId,
        leadId,
        funilId: antesLegado.funilId,
        etapaOrigem: antesLegado.etapa,
        etapaDestino: cfg.etapa,
        quem: null,
        origemMudanca: 'fluxo',
      });
    }
    return { leadId, novaEtapa: cfg.etapa };
  }

  /**
   * CRIAR_LEAD — promove uma CONVERSA a Lead (a TRIAGEM do Click-to-WhatsApp).
   *
   * O inbound de WhatsApp cria Conversation/Message e mais nada: sem este passo, a
   * atribuição do anúncio que já está gravada na conversa nunca chega ao funil.
   *
   * ⚠️ O PONTO QUE NÃO PODE FALHAR é a HERANÇA: o lead nasce com a campanha da
   * conversa (colunas utm* + `variaveis.atribuicao` no mesmo formato do lead de
   * site) e com o bloco CRU do referral em `variaveis.ctwa`. Se nascer sem herdar,
   * perde-se qual anúncio trouxe o contato — e esse dado não volta.
   *
   * IDEMPOTENTE em dois níveis: conversa que já aponta pra um lead, ou telefone que
   * já é lead (match por sufixo D18), só AMARRA e devolve o existente. Sem isso
   * cada mensagem nova do mesmo contato viraria um lead duplicado.
   */
  private async acaoCriarLead(
    cfg: CriarLeadConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
    execucaoId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'CRIAR_LEAD');
    const conversationId = ctx['conversationId'] as string | undefined;
    if (!conversationId) {
      throw new Error(
        'contexto.conversationId ausente para CRIAR_LEAD. Em produção isso quer dizer gatilho errado ' +
          '(use "Chegou mensagem num canal"); num TESTE quer dizer que o teste rodou sem ' +
          'conversa — informe uma conversa existente ao testar.',
      );
    }
    const conversa = await this.prisma.conversation.findFirst({
      where: { id: conversationId, empresaId },
      select: {
        id: true,
        peerId: true,
        peerNome: true,
        leadId: true,
        clienteId: true,
        proprietarioId: true,
        utmCampaign: true,
        metadata: true,
      },
    });
    if (!conversa) {
      throw new Error(`Conversa ${conversationId} não encontrada na empresa ${empresaId}`);
    }
    // Grupo não é contato comercial — não vira lead.
    if (conversa.peerId.includes('@g.us')) {
      return { criado: false, motivo: 'grupo', conversationId };
    }
    // Já amarrada: nada a fazer além de publicar o leadId pros nós seguintes.
    // MAS confere que o lead ainda EXISTE — `Conversation.leadId` é campo solto
    // (sem FK), então um lead apagado (na UI ou por script) deixa o ponteiro
    // órfão. Sem esta checagem a triagem morria de vez naquela conversa: dizia
    // "já tem lead", o nó de IA não achava o lead e pulava, e nada era criado
    // nem classificado — sem erro nenhum. Órfão → desamarra e segue criando.
    if (conversa.leadId) {
      const vivo = await this.prisma.lead.findFirst({
        where: { id: conversa.leadId, empresaId },
        select: { id: true },
      });
      if (vivo) {
        await this.publicarLeadNoContexto(execucaoId, ctx, conversa.leadId);
        return { criado: false, motivo: 'conversa_ja_tem_lead', leadId: conversa.leadId };
      }
      this.logger.warn(
        `CRIAR_LEAD: conversa ${conversa.id} apontava pro lead ${conversa.leadId} (apagado) — ponteiro órfão limpo`,
      );
      await this.prisma.conversation.updateMany({
        where: { id: conversa.id, empresaId },
        data: { leadId: null },
      });
    }

    const meta = (conversa.metadata as Record<string, unknown> | null) ?? {};
    // Telefone REAL: metadata.telefone (preenchido quando o peerId é LID opaco) >
    // parte local do peerId. @lid nunca vira telefone.
    const ehLid = conversa.peerId.includes('@lid');
    const telefone =
      (typeof meta.telefone === 'string' ? meta.telefone : undefined) ??
      (ehLid ? undefined : conversa.peerId.split('@')[0]?.split(':')[0]);
    const digitos = (telefone ?? '').replace(/\D/g, '');

    // Telefone que já é lead: AMARRA em vez de duplicar (D18 — sufixo de 8 dígitos
    // normalizando o valor ARMAZENADO; `contains` quebra com telefone formatado).
    if (digitos.length >= 8) {
      const sufixo = digitos.slice(-8);
      const existente = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Lead"
        WHERE "empresaId" = ${empresaId}
          AND RIGHT(REGEXP_REPLACE(COALESCE("contatoTelefone", ''), '[^0-9]', '', 'g'), 8) = ${sufixo}
        ORDER BY "atualizadoEm" DESC
        LIMIT 1
      `;
      if (existente[0]) {
        await this.prisma.conversation.updateMany({
          where: { id: conversa.id, empresaId },
          data: { leadId: existente[0].id },
        });
        await this.publicarLeadNoContexto(execucaoId, ctx, existente[0].id);
        return { criado: false, motivo: 'telefone_ja_e_lead', leadId: existente[0].id };
      }
    }

    // Etapa de destino (entrada do funil de triagem). Sem etapa configurada o lead
    // ainda nasce — só cai no funil padrão pelo caminho legado do enum.
    let funilId: string | null = null;
    let funilEtapaId: string | null = null;
    let etapaEnum: 'NOVO' | 'GANHO' | 'PERDIDO' | 'QUALIFICANDO' = 'NOVO';
    if (cfg.funilEtapaId) {
      const etapa = await this.prisma.funilEtapa.findFirst({
        where: { id: cfg.funilEtapaId, funil: { empresaId } },
        select: { id: true, funilId: true, tipo: true },
      });
      if (!etapa) {
        throw new Error(`Etapa ${cfg.funilEtapaId} não encontrada na empresa ${empresaId}`);
      }
      funilId = etapa.funilId;
      funilEtapaId = etapa.id;
      etapaEnum = etapa.tipo === 'GANHO' ? 'GANHO' : etapa.tipo === 'PERDIDO' ? 'PERDIDO' : 'NOVO';
    }

    // ── HERANÇA DA ATRIBUIÇÃO (o requisito crítico) ──────────────────────
    const referral = meta.atribuicao as CtwaReferral | undefined;
    const campanha = conversa.utmCampaign ?? campanhaDoReferral(referral);
    const variaveis: Record<string, unknown> = {};
    if (referral) {
      variaveis.atribuicao = atribuicaoDeReferral(referral, new Date().toISOString());
      // Bloco CRU junto: se amanhã precisarmos casar `ctwaClid` com o gerenciador
      // do Meta, o dado está aqui — não dá pra buscar de novo.
      variaveis.ctwa = referral;
    }
    // Veio de anúncio → click_to_whatsapp; inbound orgânico do número → whatsapp.
    const origemCadastro = cfg.origemCadastro ?? (referral ? 'click_to_whatsapp' : 'whatsapp');

    const nome = conversa.peerNome?.trim() || (digitos ? `Contato ${digitos}` : 'Contato WhatsApp');
    const lead = await this.prisma.lead.create({
      data: {
        empresaId,
        nome: nome.slice(0, 255),
        contatoNome: conversa.peerNome?.trim() ? conversa.peerNome.trim().slice(0, 255) : null,
        contatoTelefone: telefone ?? null,
        clienteId: conversa.clienteId,
        // Triagem é da casa: sem rep por padrão (o rep entra quando for triado).
        representanteId: cfg.representanteId ?? conversa.proprietarioId ?? null,
        canalOrigem: 'WHATSAPP',
        etapa: etapaEnum,
        funilId,
        funilEtapaId,
        origemCadastro,
        utmSource: referral ? 'meta' : null,
        utmMedium: referral ? 'click_to_whatsapp' : null,
        utmCampaign: campanha ?? null,
        variaveis: variaveis as Prisma.InputJsonValue,
      },
      select: { id: true, nome: true, etapa: true },
    });

    // Amarra os dois lados. Sem isto a próxima mensagem criaria outro lead.
    await this.prisma.conversation.updateMany({
      where: { id: conversa.id, empresaId },
      data: { leadId: lead.id },
    });

    // Histórico: nascimento do lead na etapa de triagem.
    if (funilEtapaId) {
      await registrarTransicaoEtapa(this.prisma, this.logger, {
        empresaId,
        leadId: lead.id,
        funilId,
        etapaOrigem: null,
        etapaDestino: funilEtapaId,
        quem: null,
        origemMudanca: 'fluxo',
      });
    }

    // Publica o lead no contexto ANTES de qualquer coisa que dependa dele — é o que
    // deixa os nós seguintes (Mudar tag, Enviar WhatsApp, Mover etapa) enxergarem
    // o lead recém-nascido. Sem isso a ação não encadeia com nada.
    await this.publicarLeadNoContexto(execucaoId, ctx, lead.id);

    if (cfg.tagNome?.trim()) {
      const nomeTag = cfg.tagNome.trim();
      const tag = await this.prisma.tag.upsert({
        where: { empresaId_nome: { empresaId, nome: nomeTag } },
        create: { empresaId, nome: nomeTag },
        update: {},
      });
      await this.prisma.leadTag.upsert({
        where: { leadId_tagId: { leadId: lead.id, tagId: tag.id } },
        create: { leadId: lead.id, tagId: tag.id, origem: 'fluxo' },
        update: {},
      });
    }

    // Mesmo evento que o lead do site dispara — fluxos de boas-vindas funcionam
    // igual pros dois. `_hops` propaga o corta-loop do FluxoEventBus.
    const hops = typeof ctx['_hops'] === 'number' ? (ctx['_hops'] as number) : 0;
    void this.bus.disparar(empresaId, 'LEAD_CRIADO', {
      leadId: lead.id,
      origemCadastro,
      lead: { id: lead.id, nome: lead.nome, etapa: lead.etapa, valorEstimado: 0 },
      clienteId: conversa.clienteId,
      representanteId: cfg.representanteId ?? conversa.proprietarioId ?? null,
      _hops: hops + 1,
    });

    return {
      criado: true,
      leadId: lead.id,
      conversationId: conversa.id,
      origemCadastro,
      utmCampaign: campanha ?? null,
      herdouAtribuicao: !!referral,
    };
  }

  /**
   * TRANSFERIR_ATENDIMENTO — passa a conversa do bot pro humano no MESMO número
   * (atrito zero). A branch financeiro/suporte da triagem chama este nó.
   *
   * Faz três coisas de uma vez, na ordem que importa:
   *  1. PAUSA o bot na conversa (`precisaHumano=true`) — item MAIS crítico: sem
   *     isso o bot e o atendente respondem juntos na frente do cliente. O gate do
   *     bot (muller-whatsapp) checa `precisaHumano` e cala até o operador responder.
   *  2. ATRIBUI: com `atendenteId` → dono direto (modo A); sem → fila sem dono
   *     (modo B). `categoria` (default POS_VENDA) tira a conversa do fluxo de venda.
   *  3. NOTIFICA: o atendente (modo A) ou o papel SAC (modo B) — best-effort.
   */
  private async acaoTransferirAtendimento(
    cfg: TransferirAtendimentoConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    this.assertEmpresaId(empresaId, 'TRANSFERIR_ATENDIMENTO');
    const conversationId = ctx['conversationId'] as string | undefined;
    if (!conversationId) {
      throw new Error(
        'contexto.conversationId ausente para TRANSFERIR_ATENDIMENTO. Em produção isso quer dizer gatilho errado ' +
          '(use "Chegou mensagem num canal"); num TESTE quer dizer que o teste rodou sem ' +
          'conversa — informe uma conversa existente ao testar.',
      );
    }
    const conversa = await this.prisma.conversation.findFirst({
      where: { id: conversationId, empresaId },
      select: { id: true, peerNome: true, atribuidoId: true },
    });
    if (!conversa) {
      throw new Error(`Conversa ${conversationId} não encontrada na empresa ${empresaId}`);
    }

    // Atendente específico (modo A): valida que é da empresa antes de atribuir.
    let atendenteId: string | null = null;
    if (cfg.atendenteId) {
      const ok = await this.prisma.usuario.findFirst({
        where: { id: cfg.atendenteId, empresas: { some: { empresaId } } },
        select: { id: true },
      });
      if (!ok) throw new Error(`Atendente ${cfg.atendenteId} não pertence à empresa ${empresaId}`);
      atendenteId = cfg.atendenteId;
    }

    const categoria = cfg.categoria ?? 'POS_VENDA';
    await this.prisma.conversation.updateMany({
      where: { id: conversa.id, empresaId },
      data: {
        // 1) PAUSA o bot — o dado que garante "atrito zero".
        precisaHumano: true,
        // 2) atribui (ou deixa na fila) + tira do fluxo de venda + reabre.
        ...(atendenteId ? { atribuidoId: atendenteId } : {}),
        categoria,
        status: 'ABERTA',
      },
    });

    // 3) Notifica (best-effort — falhar aqui não desfaz a transferência).
    const quem = conversa.peerNome?.trim() || 'um contato';
    const link = `/inbox?conversa=${conversa.id}`;
    try {
      if (atendenteId) {
        await this.notificacoes.criarParaUsuario({
          empresaId,
          usuarioId: atendenteId,
          tipo: 'MENSAGEM_INBOX',
          titulo: 'Conversa transferida pra você',
          mensagem: `${quem} foi transferido pra você no atendimento. O bot foi pausado nessa conversa.`,
          link,
          metadata: { conversationId: conversa.id },
        });
      } else {
        const roles = cfg.notificarRoles?.length ? cfg.notificarRoles : (['SAC'] as const);
        await this.notificacoes.criarParaRole({
          empresaId,
          roles: [...roles],
          tipo: 'MENSAGEM_INBOX',
          titulo: 'Nova conversa na fila de atendimento',
          mensagem: `${quem} caiu na fila de atendimento. O bot foi pausado — quem estiver livre pode assumir.`,
          link,
          metadata: { conversationId: conversa.id },
        });
      }
    } catch (err) {
      this.logger.error(
        `TRANSFERIR_ATENDIMENTO: conversa ${conversa.id} transferida mas notificação falhou: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      transferido: true,
      conversationId: conversa.id,
      atendenteId,
      fila: !atendenteId,
      categoria,
    };
  }

  /**
   * Grava o `leadId` no contexto DA EXECUÇÃO (não só na cópia em memória): cada
   * passo seguinte é um job novo que recarrega `FluxoExecucao.contexto` do banco.
   * Sem persistir, o lead criado pelo CRIAR_LEAD sumiria no próximo nó.
   * Best-effort — o lead já existe; falhar aqui não pode desfazer a criação.
   */
  private async publicarLeadNoContexto(
    execucaoId: string,
    ctx: ExecucaoContexto,
    leadId: string,
  ): Promise<void> {
    ctx['leadId'] = leadId;
    try {
      const atual = await this.prisma.fluxoExecucao.findUnique({
        where: { id: execucaoId },
        select: { contexto: true },
      });
      const base = (atual?.contexto as Record<string, unknown> | null) ?? {};
      await this.prisma.fluxoExecucao.update({
        where: { id: execucaoId },
        data: { contexto: { ...base, leadId } as Prisma.InputJsonValue },
      });
    } catch (err) {
      this.logger.error(
        `CRIAR_LEAD: lead ${leadId} criado mas não publicado no contexto da execução ${execucaoId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
    // CAÇADA-BUG #39: casa a conversa pelo SUFIXO EXATO do telefone (D18), NÃO por `contains` — que
    // casava o sufixo de 8 dígitos no MEIO de outro número (ex.: lead …8765-4321 pausava também o peer
    // 55 87 6543-2199 de Pernambuco, DDD 87) → pausava/religava o bot na conversa ERRADA. Padrão
    // canônico do repo (fix 707c3bc): RIGHT(REGEXP_REPLACE(...),8) = sufixo via $queryRaw, restrito a
    // @s.whatsapp.net (peer pessoal — nunca grupo/@lid).
    const conversas = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Conversation"
      WHERE "empresaId" = ${empresaId} AND "canal" = 'WHATSAPP'
        AND "peerId" LIKE '%@s.whatsapp.net'
        AND RIGHT(REGEXP_REPLACE(split_part("peerId", '@', 1), '[^0-9]', '', 'g'), 8) = ${sufixo}`;
    if (conversas.length === 0) {
      return { leadId, sufixo, botLigado: religar, conversasAtualizadas: 0 };
    }
    const { count } = await this.prisma.conversation.updateMany({
      where: { id: { in: conversas.map((c) => c.id) }, empresaId },
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
    // Config vazia (a ação ficou tempos na paleta sem formulário): o findFirst
    // com id undefined DESCARTA o filtro e casaria o primeiro usuário qualquer
    // da empresa. Falha explícita em vez de atribuir pra alguém aleatório.
    if (!cfg.representanteId) {
      throw new Error('ATRIBUIR_REP exige representanteId — configure o representante no nó');
    }
    const clienteId = ctx['clienteId'] as string | undefined;
    const leadId = ctx['leadId'] as string | undefined;

    // AUDITORIA 2026-05-15: valida que o rep destino pertence à empresa
    const rep = await this.prisma.usuario.findFirst({
      where: {
        id: cfg.representanteId,
        empresas: { some: { empresaId } },
      },
      select: { id: true, nome: true, status: true, role: true },
    });
    if (!rep) {
      throw new Error(`Rep ${cfg.representanteId} não pertence à empresa ${empresaId}`);
    }
    // Pergunta que veio da master de fluxos (11/08): o motor aceita atribuir a
    // usuário PENDENTE? Aceitava — e a usuário INATIVO também, que é o problema
    // de verdade. Atribuir carteira a quem foi DESATIVADO repete exatamente o
    // que o D42 evita no lado do gerente: o lead fica com dono que não entra no
    // sistema, some da fila de todo mundo e ninguém percebe. Aqui é erro.
    if (rep.status === 'INATIVO') {
      throw new Error(
        `Rep ${rep.nome} está INATIVO — atribuir a ele deixaria o lead sem dono efetivo. ` +
          'Escolha outro representante no nó ou reative o usuário.',
      );
    }
    // PENDENTE (convidado, ainda não entrou) é LEGÍTIMO: é assim que um rep novo
    // recebe carteira antes do primeiro login. Só fica visível no log.
    if (rep.status === 'PENDENTE') {
      this.logger.warn(
        `ATRIBUIR_REP: ${rep.nome} ainda está PENDENTE (não fez o primeiro acesso). ` +
          'A atribuição vale, mas ele só vê a carteira depois de entrar.',
      );
    }
    // Papel: não bloqueia (config antiga pode apontar pra GERENTE de propósito),
    // mas atribuir carteira a SAC/ADMIN é quase sempre engano de configuração.
    if (rep.role !== 'REP' && rep.role !== 'GERENTE') {
      this.logger.warn(
        `ATRIBUIR_REP: ${rep.nome} tem papel ${rep.role}, não REP/GERENTE — confira o nó.`,
      );
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

    // Capacidade da etapa destino (anti-sobrecarga): nunca libera além das vagas.
    // Dois caps possíveis (usa o menor): (a) `capacidadeMaxima` da própria etapa;
    // (b) `respeitarCapacidadeDestino` no nó → `quantidade` vira o MÁXIMO na destino
    // (ex: quantidade=1 = mantém 1 lead na abordagem por vez; só libera quando o
    // atual sair). Sem cap → `quantidade` é só o lote por execução.
    const capEtapa = destino.capacidadeMaxima ?? null;
    const capNo = cfg.respeitarCapacidadeDestino ? quantidade : null;
    const cap = capEtapa != null && capNo != null ? Math.min(capEtapa, capNo) : (capEtapa ?? capNo);
    let limite = quantidade;
    if (cap != null) {
      const ocupacao = await this.prisma.lead.count({
        where: { empresaId, funilEtapaId: cfg.etapaDestinoId },
      });
      limite = Math.min(quantidade, Math.max(0, cap - ocupacao));
    }
    if (limite === 0) {
      this.logger.log(`LIBERAR_LOTE: etapa destino ${cfg.etapaDestinoId} cheia — nada liberado`);
      return {
        movidos: 0,
        etapaDestinoId: cfg.etapaDestinoId,
        motivo: 'etapa destino cheia',
        semEfeito: true,
      };
    }

    // Exclui leads que tenham QUALQUER uma das tags marcadas (ex: 'pausado' —
    // tira manualmente da fila sem deletar).
    const excluiTags = (cfg.filtroExcluiTag ?? []).filter(
      (t) => typeof t === 'string' && t.trim().length > 0,
    );
    // Inclusão: só leads que TÊM alguma das tags (ex: cron de reaquecimento pega
    // 'Reaquecer 🟡' OU 'Sem Resposta ⚫'). Vazio = sem restrição (comportamento legado).
    const comTags = (cfg.filtroComTag ?? []).filter(
      (t) => typeof t === 'string' && t.trim().length > 0,
    );
    const where: Prisma.LeadWhereInput = {
      empresaId,
      funilEtapaId: cfg.etapaOrigemId,
      ...(cfg.funilId ? { funilId: cfg.funilId } : {}),
      ...(comTags.length ? { tags: { some: { tag: { nome: { in: comTags } } } } } : {}),
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

    let movidos = 0;
    for (const lead of leads) {
      // CAS: só move se o lead AINDA está na etapa de origem. Duas execuções LIBERAR_LOTE
      // concorrentes (cron lento + sobreposição) não movem o mesmo lead 2× nem disparam
      // o opener em dobro — a 2ª acha count===0 e pula.
      const r = await this.prisma.lead.updateMany({
        where: { id: lead.id, empresaId, funilEtapaId: cfg.etapaOrigemId },
        data: { funilEtapaId: cfg.etapaDestinoId, etapa: etapaEnum, etapaDesde: new Date() },
      });
      if (r.count === 0) continue; // outro lote já moveu este lead
      movidos++;
      // Histórico: transição por FLUXO (LIBERAR_LOTE move o lead pela etapa).
      await registrarTransicaoEtapa(this.prisma, this.logger, {
        empresaId,
        leadId: lead.id,
        funilId: destino.funilId,
        etapaOrigem: cfg.etapaOrigemId,
        etapaDestino: cfg.etapaDestinoId,
        quem: null,
        origemMudanca: 'fluxo',
      });
      // Dispara os fluxos da etapa destino (1 por lead). Nomes canônicos +
      // funilId pra o filtro do gatilho "Lead mudou etapa" casar (FluxoEventBus).
      // _hops=1: início de cadeia interna (corta-loop do FluxoEventBus).
      await this.bus.disparar(empresaId, 'LEAD_ETAPA_MUDOU', {
        leadId: lead.id,
        funilId: destino.funilId,
        deFunilEtapaId: cfg.etapaOrigemId,
        paraFunilEtapaId: cfg.etapaDestinoId,
        _hops: 1,
      });
    }

    this.logger.log(
      `LIBERAR_LOTE: ${movidos} lead(s) ${cfg.etapaOrigemId} → ${cfg.etapaDestinoId} (empresa ${empresaId})`,
    );
    // movidos:0 (origem vazia / todos filtrados / já movidos) → marca semEfeito pro executor
    // descartar a execução vazia (não polui o histórico no cron a cada 1min).
    return {
      movidos,
      etapaDestinoId: cfg.etapaDestinoId,
      ...(movidos === 0 ? { semEfeito: true } : {}),
    };
  }

  private async acaoWebhookExterno(
    cfg: WebhookExternoConfig,
    ctx: ExecucaoContexto,
    idemBase: string,
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
    // Oferece chave de idempotência ao receptor (Stripe-style). A dedup efetiva depende
    // de o receptor honrar o header — fora do nosso controle, mas a chave vai disponível.
    // `cfg.headers` do usuário tem precedência (pode sobrescrever o nome do header).
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [cfg.idempotencyHeader ?? 'X-Idempotency-Key']: idemBase,
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
