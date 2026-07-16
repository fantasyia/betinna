import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { MessageDirection, Prisma } from '@prisma/client';
import type { FluxoExecucao, FluxoNo } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { interpolate } from '@shared/utils/interpolate';
import { WhatsAppService } from '@integrations/whatsapp/whatsapp.service';
import { MullerBotService } from '@modules/mullerbot/mullerbot.service';
import { BotCustoService } from '@modules/mullerbot/bot-custo.service';
import { MullerBotPersonaService } from '@modules/mullerbot/persona.service';
import { ProdutoSearchService } from '@modules/mullerbot/produto-search.service';
import { KnowledgeSearchService } from '@modules/rag/knowledge-search.service';
import {
  enviarEmBaloes,
  prepararEntradaMultimodal,
} from '@modules/mullerbot/muller-whatsapp.service';
import type { MensagemEntranteParams } from '@modules/inbox/inbox.types';
import type { HistoricoMsg } from '@modules/mullerbot/mullerbot-cache.service';
import { WhatsappPacingService } from '@shared/whatsapp-pacing/whatsapp-pacing.service';
import { SupressaoService } from '@shared/supressao/supressao.service';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import {
  FLUXO_QUEUE,
  unidadeTempoMs,
  type FluxoStepJobData,
  type ConversarIaConfig,
  type ExecucaoContexto,
  SINAIS_ROTEAMENTO,
} from './fluxo-executor.types';

/** Default de mensagens no histórico quando a empresa não configurou (= persona.service). */
const HISTORICO_DEFAULT = 10;
/** Teto de re-disparos do ramo "timeout" por execução (anti-loop de follow-up). */
const MAX_TIMEOUT_FOLLOWS = 5;

/** Instrução pra IA abrir a conversa (primeira mensagem). */
const INSTRUCAO_OPENER =
  '\n\n[Tarefa agora] Inicie a conversa com o lead: escreva a PRIMEIRA mensagem de abordagem, ' +
  'curta e natural (estilo WhatsApp). Pode separar em 2-3 mensagens curtas com "|||". ' +
  'Responda apenas com a mensagem, sem aspas nem rótulos.';

/** Primeiro nome a partir do nome completo (vazio se não houver). */
function primeiroNomeDe(nome?: string | null): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Mapeia o mimetype do arquivo pro tipo de mídia do WhatsApp (default DOCUMENT). */
function tipoMidiaDeMime(mime: string): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'IMAGE';
  if (m.startsWith('video/')) return 'VIDEO';
  if (m.startsWith('audio/')) return 'AUDIO';
  return 'DOCUMENT';
}

/** Marcação de envio de arquivo que a IA insere na resposta: `[[ENVIAR_DOC:<id>]]`. */
const RE_ENVIAR_DOC = /\[\[\s*ENVIAR_DOC\s*:\s*([\w-]+)\s*\]\]/gi;

/**
 * Tool-use por marcador: extrai os ids de `[[ENVIAR_DOC:id]]` da resposta da IA e
 * devolve o texto sem as marcações (ids deduplicados, na ordem em que apareceram).
 */
export function extrairMarcadoresDoc(texto: string): { limpo: string; ids: string[] } {
  const ids: string[] = [];
  const limpo = texto
    .replace(RE_ENVIAR_DOC, (_m, id: string) => {
      ids.push(id);
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { limpo, ids: Array.from(new Set(ids)) };
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
  '- "resposta" é a MENSAGEM que vai pro lead no WhatsApp: 2ª pessoa, curta e natural ' +
  '(quebre em 2 a 4 mensagens com "|||"; nunca um parágrafo único longo). É APENAS a fala ' +
  'humana pro lead. NUNCA escreva aqui rótulos, status, decisões ou notas internas ' +
  '(ex: "classificação interna", "classifiquei", "pronto", o nome do rótulo) — isso é a SUA ' +
  'anotação e vai nos outros campos, NÃO na "resposta".\n' +
  '- "classificou": true SOMENTE quando já houver informação suficiente pra concluir; senão ' +
  'false e continue a conversa com naturalidade.\n' +
  '- Quando "classificou" for true, a "resposta" é um ENCERRAMENTO caloroso e COMPLETO: ' +
  'reconheça o que o lead disse, agradeça e deixe uma porta aberta amigável — sem ser seco ' +
  'nem robótico. NÃO termine com pergunta que exija resposta (a conversa está se encerrando).\n' +
  '- "classificacao"/"variaveis": preencha só quando "classificou" for true (ficam na anotação, ' +
  'fora da "resposta").\n' +
  '- REGRA DE ENCERRAMENTO (CRÍTICA): TODA vez que você ENCERRAR/se despedir — sem sinergia, ' +
  'pedido de remoção, contato não engaja, fim natural da conversa — marque "classificou": true E ' +
  'grave a "classificacao" + as "variaveis" de fechamento (ex: classificacao_final, trilho, ' +
  'pedido_remocao) NO MESMO turno da despedida. NUNCA mande a mensagem de despedida com ' +
  '"classificou": false nem "esqueça" a variável de fechamento — é ESSE sinal que a plataforma usa ' +
  'pra finalizar e rotear; sem ele NO turno da despedida, a conversa fica presa sem tag nem ação.';

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

/**
 * Detecta PEDIDO DE REMOÇÃO / descadastro (LGPD) na mensagem do LEAD. Rede de
 * segurança DETERMINÍSTICA: o LLM às vezes responde a despedida de remoção só em
 * TEXTO, sem gravar `pedido_remocao=sim` naquele turno → o nó ficava preso em
 * AGUARDANDO e não roteava. Detectar no texto do lead força o sinal, sem depender
 * do LLM. É um direito legal — tem que funcionar SEMPRE.
 */
const PADROES_REMOCAO: RegExp[] = [
  /\btir[ae]r?\s+(o\s+)?(meu|meu\s+)?\s*(n[uú]mero|contato|nome|cadastro)/i,
  // "me tira/remove/exclui" SÓ com destino de cadastro — "me tira uma dúvida" /
  // "pode me tirar uma foto" é lead ENGAJADO, não LGPD (falso positivo real)
  /\bme\s+(tir[ae]r?|remov[ae]r?|exclu[ai]r?)\s+(daqui|(d[aeo]s?|dess[ae]s?|dest[ae]s?)\s+(seus?\s+|suas?\s+)?\w*(lista|grupo|cadastro|base|mailing|whats\w*|zap|contatos?))/i,
  /\bme\s+(descadastr\w*|desinscrev\w*)/i,
  /\bdescadastr\w*/i,
  /\bsai[ar]?\s+d[ae]\s+(sua|essa|dessa)\s+lista/i,
  /\bsair\s+da\s+lista/i,
  /\bn[aã]o\s+(quero|desejo)\s+(mais\s+)?(receber|ser\s+(contact|procurad|chamad|abordad))/i,
  /\bn[aã]o\s+me\s+(mand|envi|cham|procur|perturb|contat)\w*/i,
  /\bpar[ae]\s+de\s+(me\s+)?(mand|envi|cham|procur|contat)\w*/i,
  // idem: "remover o meu" precisa do OBJETO de cadastro ("remove meu desconto" ≠ LGPD)
  /\bremov[ae]r?\s+(o\s+|a\s+)?(meu|minha)\s+(n[uú]mero|contato|nome|cadastro|telefone|zap|whats\w*)/i,
  /\bunsubscribe\b/i,
];

export function pedidoRemocaoNoTexto(texto: string): boolean {
  const t = (texto ?? '').trim();
  return t.length > 0 && PADROES_REMOCAO.some((re) => re.test(t));
}

/**
 * Detecta que a IA está ENCERRANDO a conversa pela RESPOSTA dela (despedida),
 * mesmo sem ter emitido a variável de classificação. Padrões do prompt de
 * encerramento (Sem Sinergia / trava anti-loop / "não é o perfil"). Conservador:
 * só dispara em frases claras de despedida — pra não classificar no meio da
 * conversa. Quando dispara sem classificação, o motor força a classificação
 * (classificarEncerramento) em vez de deixar o nó preso em AGUARDANDO.
 */
const PADROES_DESPEDIDA_FORTE: RegExp[] = [
  /\bte\s+deixar\s+em\s+paz/i,
  /\bvou\s+(te\s+)?deixar\s+(voc[eê]\s+)?(em\s+paz|por\s+aqui|tranquil)/i,
  /\bn[aã]o\s+é\s+(bem\s+)?o\s+(perfil|encaixe)/i,
  /\bn[aã]o\s+é\s+bem\s+o\s+que\s+eu\s+(procuro|busco)/i,
  /\bvaleu\s+(demais\s+)?pela\s+conversa/i,
  /\bse\s+um\s+dia\s+quiser/i,
  /\bpeguei\s+voc[eê]\s+num\s+momento/i,
];
// Cortesia que também aparece no MEIO da conversa ("fico à disposição", "sucesso
// no evento") — sozinha NÃO é despedida (encerrava entrevista viva); só em dupla.
const PADROES_DESPEDIDA_FRACA: RegExp[] = [
  /\bsucesso\s+(a[íi]|pra\s+voc[eê]|no|nos)/i,
  /\bé\s+só\s+me\s+chamar/i,
  /\bfico\s+à\s+disposi/i,
  /\bqualquer\s+coisa\s+(é\s+só|estou|tô)/i,
];

export function respostaEhDespedida(texto: string): boolean {
  const t = (texto ?? '').trim();
  if (!t) return false;
  // Turno que TERMINA perguntando ainda está engajando — não é despedida.
  if (/[?？]\s*$/.test(t)) return false;
  if (PADROES_DESPEDIDA_FORTE.some((re) => re.test(t))) return true;
  return PADROES_DESPEDIDA_FRACA.filter((re) => re.test(t)).length >= 2;
}

const toJsonInput = (v: Record<string, unknown>): Prisma.InputJsonObject =>
  v as unknown as Prisma.InputJsonObject;

/**
 * Mescla o histórico da CONVERSA real (montarHistorico — cobre TODAS as execuções
 * do lead, fonte da verdade entre elas) com o _iaHistorico desta execução (cobre o
 * provider que não ecoa o outbound). Ordena por tempo e remove duplicatas
 * consecutivas (a mesma fala aparece nas duas fontes). DEFESA EM PROFUNDIDADE: mesmo
 * com execução duplicada (race) ou eco faltando, a IA SEMPRE enxerga o que já foi
 * dito ao lead → não se reapresenta do zero.
 */
export function mesclarHistorico(
  daConversa: HistoricoMsg[],
  doContexto: HistoricoMsg[],
  max: number,
): HistoricoMsg[] {
  const todos = [...daConversa, ...doContexto]
    .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
    .sort((x, y) => (x.at ?? 0) - (y.at ?? 0));
  // Eco das duas fontes tem timestamps quase idênticos; 'oi'/'oi' de verdade do lead vem com
  // segundos de diferença. Só colapsa quando role+conteúdo batem E os timestamps estão próximos
  // — senão uma repetição genuína seria descartada e a IA perderia o sinal de duas mensagens.
  // (Sem timestamp em ambos → at=0 → proximo=true → mantém o comportamento antigo de dedup.)
  const ECO_MS = 5_000;
  const out: HistoricoMsg[] = [];
  for (const m of todos) {
    const ult = out[out.length - 1];
    const mesmaFala = ult && ult.role === m.role && ult.content.trim() === m.content.trim();
    const proximo = ult ? Math.abs((m.at ?? 0) - (ult.at ?? 0)) <= ECO_MS : false;
    if (mesmaFala && proximo) continue;
    out.push(m);
  }
  return out.slice(-max);
}

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
    private readonly produtoSearch: ProdutoSearchService,
    private readonly conhecimentoSearch: KnowledgeSearchService,
    private readonly custo: BotCustoService,
    private readonly whatsapp: WhatsAppService,
    private readonly bus: FluxoEventBusService,
    private readonly pacing: WhatsappPacingService,
    private readonly supressao: SupressaoService,
    @InjectQueue(FLUXO_QUEUE) private readonly queue: Queue<FluxoStepJobData>,
  ) {}

  /**
   * RAG — monta o bloco de contexto (catálogo + conhecimento) pra anexar ao system
   * prompt, com guardrails anti-alucinação. Retorna '' quando o nó não pediu RAG ou
   * nada relevante foi encontrado. A recuperação é por busca semântica (fallback
   * keyword) sobre a mensagem do lead.
   */
  private async montarBlocoRag(
    empresaId: string,
    textoLead: string,
    cfg: ConversarIaConfig,
  ): Promise<string> {
    const consulta = textoLead.trim();
    if (consulta.length === 0) return '';
    if (!cfg.consultarCatalogo && !cfg.consultarConhecimento) return '';

    const partes: string[] = [];

    if (cfg.consultarCatalogo) {
      const produtos = await this.produtoSearch.buscar(empresaId, consulta, 5).catch(() => []);
      if (produtos.length > 0) {
        const linhas = produtos.map((p) => {
          const preco = `R$ ${p.precoTabela.toFixed(2)}`;
          const detalhe = [p.marca, p.linha, p.unidade].filter(Boolean).join(', ');
          return `- ${p.nome}${detalhe ? ` (${detalhe})` : ''} — ${preco}${p.sku ? ` [SKU ${p.sku}]` : ''}`;
        });
        partes.push(`PRODUTOS DO CATÁLOGO (use só estes; preços oficiais):\n${linhas.join('\n')}`);
      }
    }

    if (cfg.consultarConhecimento) {
      const chunks = await this.conhecimentoSearch.buscar(empresaId, consulta, 4).catch(() => []);
      if (chunks.length > 0) {
        const linhas = chunks.map((c) => `- ${c.titulo}: ${c.conteudo}`);
        partes.push(`INFORMAÇÕES DA EMPRESA:\n${linhas.join('\n')}`);
      }
    }

    // Arquivos que o bot pode ENVIAR (docs com podeEnviar=true): a IA decide enviar
    // marcando [[ENVIAR_DOC:id]] no fim da resposta (tool-use por marcador).
    const blocoDocs = cfg.consultarConhecimento
      ? await this.montarBlocoDocsEnviaveis(empresaId)
      : '';

    if (partes.length === 0 && !blocoDocs) return '';
    let bloco = '';
    if (partes.length > 0) {
      bloco +=
        '\n\n--- CONTEXTO (RAG) ---\n' +
        'Responda usando SOMENTE as informações abaixo. Se a resposta não estiver aqui, ' +
        'diga que vai verificar — NUNCA invente preço, SKU, prazo ou condição.\n\n' +
        partes.join('\n\n');
    }
    return bloco + blocoDocs;
  }

  /**
   * Lista os documentos que o bot pode ENVIAR (KnowledgeDocumento.podeEnviar) e ensina
   * a IA a disparar o envio marcando `[[ENVIAR_DOC:id]]`. O envio real acontece em
   * `enviarDocumentos`, que re-valida id × empresa × podeEnviar (a IA nunca envia algo
   * fora desta lista, mesmo que alucine um id).
   */
  private async montarBlocoDocsEnviaveis(empresaId: string): Promise<string> {
    const docs = await this.prisma.knowledgeDocumento
      .findMany({
        where: { empresaId, podeEnviar: true },
        select: { id: true, titulo: true },
        orderBy: { criadoEm: 'desc' },
        take: 10,
      })
      .catch(() => [] as Array<{ id: string; titulo: string }>);
    if (docs.length === 0) return '';
    const linhas = docs.map((d) => `- "${d.titulo}" (id: ${d.id})`);
    return (
      '\n\n--- ARQUIVOS QUE VOCÊ PODE ENVIAR ---\n' +
      'Estes arquivos estão disponíveis pra mandar ao lead:\n' +
      linhas.join('\n') +
      '\nSe (e somente se) o lead pedir um destes arquivos, escreva uma frase curta avisando ' +
      'que vai enviar e inclua no FINAL da sua resposta a marcação [[ENVIAR_DOC:id]] com o id ' +
      'EXATO da lista (uma marcação por arquivo). NUNCA invente um id nem ofereça arquivo fora ' +
      'desta lista.'
    );
  }

  /**
   * Envia os documentos pedidos pela IA. Re-valida cada id contra (empresa × podeEnviar)
   * — a IA nunca manda nada fora da lista, mesmo alucinando um id. Best-effort: falha de
   * um arquivo não derruba o turno.
   */
  private async enviarDocumentos(
    empresaId: string,
    telefone: string,
    ids: string[],
    idemBase: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const peerId = `${telefone.replace(/[^\d+]/g, '')}@s.whatsapp.net`;
    for (const id of ids) {
      const doc = await this.prisma.knowledgeDocumento.findFirst({
        where: { id, empresaId, podeEnviar: true },
        select: { id: true, storagePath: true, mimetype: true, fileName: true },
      });
      if (!doc) {
        this.logger.warn(
          `CONVERSAR_IA: IA pediu enviar doc "${id}" inexistente/não-enviável (emp ${empresaId}) — ignorado`,
        );
        continue;
      }
      try {
        await this.pacing.aguardarSlot(empresaId, true);
        await this.whatsapp.enviarMidia(
          empresaId,
          peerId,
          {
            tipo: tipoMidiaDeMime(doc.mimetype),
            storagePath: doc.storagePath,
            mimetype: doc.mimetype,
            fileName: doc.fileName,
          },
          { idempotencyKey: `${idemBase}:doc:${doc.id}` },
        );
      } catch (err) {
        this.logger.warn(
          `CONVERSAR_IA: falha ao enviar doc ${doc.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /**
   * Classificação de ENCERRAMENTO forçada: quando a IA se despede SEM emitir o
   * rótulo, uma chamada dedicada (schema estrito, não fala com o lead) devolve a
   * classificação pro roteador — em vez de deixar o nó preso em AGUARDANDO.
   * Default "Sem Sinergia" (despedida sem engajamento ≈ não-encaixe; outcome
   * seguro → Perdido). Best-effort: qualquer falha cai em "Sem Sinergia".
   */
  private async classificarEncerramento(
    empresaId: string,
    _cfg: ConversarIaConfig,
    historico: HistoricoMsg[],
  ): Promise<string> {
    const LABELS = ['Ativar Agora', 'Reaquecer', 'Sem Sinergia'];
    const prompt =
      'Você é um CLASSIFICADOR interno (NÃO fala com o lead). Com base na conversa acima, ' +
      'classifique o LEAD e responda APENAS um JSON {"classificacao_final":"<opção>"}, uma das ' +
      'opções EXATAS:\n' +
      '- "Ativar Agora": tem acesso a indústria E topa representar E já sinalizou oportunidade concreta.\n' +
      '- "Reaquecer": tem perfil de representante mas ainda SEM oportunidade concreta (ou indeciso).\n' +
      '- "Sem Sinergia": NÃO tem acesso a indústria, ou NÃO quer representar, ou não engajou/só zoou.\n' +
      'Na dúvida, ou se o contato não engajou de verdade, use "Sem Sinergia".';
    try {
      const r = await this.muller.gerarRespostaIa(
        empresaId,
        prompt,
        '(classifique a conversa acima em UMA opção)',
        historico,
      );
      await this.custo.registrarUso(empresaId, r.tokensIn ?? 0, r.tokensOut ?? 0);
      const limpo = r.texto
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      let rotulo = '';
      try {
        const o = JSON.parse(limpo) as Record<string, unknown>;
        rotulo = typeof o.classificacao_final === 'string' ? o.classificacao_final.trim() : '';
      } catch {
        rotulo = LABELS.find((l) => limpo.toLowerCase().includes(l.toLowerCase())) ?? '';
      }
      return LABELS.find((l) => l.toLowerCase() === rotulo.toLowerCase()) ?? 'Sem Sinergia';
    } catch {
      return 'Sem Sinergia';
    }
  }

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
  ): Promise<{
    aguardando: boolean;
    pulado?: boolean;
    motivo?: string;
    /** Capturou erro de IA/WhatsApp e roteou pela saída "erro" (executor não segue o caminho normal). */
    roteado?: boolean;
    tipoErro?: string;
  }> {
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

    // Supressão LGPD: lead com a tag "Não Reabordar - LGPD ⛔" não é abordado.
    if (await this.supressao.suprimido(empresaId, { leadId })) {
      this.logger.log(
        `CONVERSAR_IA: lead ${leadId} suprimido (LGPD) — pulado (exec ${execucaoId})`,
      );
      return {
        aguardando: false,
        pulado: true,
        motivo: 'lead suprimido (Não Reabordar - LGPD)',
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

    // Isolamento por conversa: zera os sinais de roteamento/encerramento que
    // sobraram de uma abordagem ANTERIOR do mesmo lead. Sem isto, um
    // `classificacao_final` velho poderia rotear a conversa nova (o roteador lê
    // custom.classificacao_final) — a "classificação velha" do card.
    await this.limparSinaisRoteamento(leadId, empresaId);

    // Teto de tokens do prompt (Fase C — spec §7).
    if (!(await this.tetoPromptOk(cfg.promptId))) {
      this.logger.warn(
        `Prompt ${cfg.promptId} atingiu o teto de tokens — CONVERSAR_IA pulado (exec ${execucaoId})`,
      );
      // CAÇADA-BUG #17: retornava `{ aguardando: false }` cru (sem pulado/roteado) → o executor caía
      // no seguimento genérico e disparava TODAS as saídas (classificou+timeout+erro) de uma vez.
      // Marca `pulado` (o que o comentário sempre disse) → encerra a execução limpa, sem ramos.
      return {
        aguardando: false,
        pulado: true,
        motivo: 'prompt atingiu o teto de tokens — abordagem pulada',
      };
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
    // Teto de custo do bot (por-empresa): se a empresa estourou o orçamento de tokens
    // do dia/mês, o nó NÃO abre conversa por IA — roteia pela saída "erro" (mesmo gate
    // do bot reativo; antes o fluxo ignorava o teto e gerava custo mesmo pausado).
    const custoOpener = await this.custo.verificarTeto(empresaId);
    if (custoOpener.bloqueado) {
      const { tipo_erro } = await this.rotearParaErro(
        execucaoId,
        no.id,
        ctx,
        'ia_custo_excedido',
        new Error(custoOpener.motivo ?? 'Teto de custo do bot atingido'),
      );
      return { aguardando: false, roteado: true, tipoErro: tipo_erro };
    }
    let abertura: { texto: string; tokensIn?: number; tokensOut?: number };
    try {
      abertura = await this.muller.gerarRespostaIa(
        empresaId,
        systemPrompt + opener,
        '(inicie)',
        [],
      );
    } catch (err) {
      // Falha da IA/provedor: roteia pela saída "erro" em vez de derrubar a execução.
      const { tipo_erro } = await this.rotearParaErro(
        execucaoId,
        no.id,
        ctx,
        this.tipoErroIa(err),
        err,
      );
      return { aguardando: false, roteado: true, tipoErro: tipo_erro };
    }
    await this.registrarUsoPrompt(
      cfg.promptId,
      (abertura.tokensIn ?? 0) + (abertura.tokensOut ?? 0),
    );
    // Contabiliza os tokens no orçamento de custo do bot (best-effort) — senão o nó de
    // fluxo gastava sem nunca contar pro teto.
    await this.custo.registrarUso(empresaId, abertura.tokensIn ?? 0, abertura.tokensOut ?? 0);
    const aberturaTexto = personalizarNome(abertura.texto, lead.contatoNome);
    try {
      await this.enviarWhatsapp(
        empresaId,
        lead.contatoTelefone,
        aberturaTexto,
        false,
        `fx:${execucaoId}:${no.id}:opener`,
      );
    } catch (err) {
      const { tipo_erro } = await this.rotearParaErro(
        execucaoId,
        no.id,
        ctx,
        'whatsapp_falha',
        err,
      );
      return { aguardando: false, roteado: true, tipoErro: tipo_erro };
    }

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

  /**
   * Prepara a entrada multimodal do lead pra IA — MESMA lógica do bot geral
   * (`prepararEntradaMultimodal`): transcreve áudio / prepara imagem pra visão,
   * conforme a Persona. Chamado pela orquestração antes do `retomar`. Sem isso o
   * fluxo recebia "[áudio]"/"[imagem]" cru (distinção que não deve existir).
   */
  async prepararEntrada(
    params: MensagemEntranteParams,
    messageId: string,
  ): Promise<{ mensagemIA: string; imagemDataUrl?: string }> {
    const cfg = await this.persona.obterConfigBot(params.empresaId).catch(() => null);
    if (!cfg) return { mensagemIA: params.conteudo };
    return prepararEntradaMultimodal(params, cfg, {
      baixarMidia: (url) => this.whatsapp.baixarMidia(url),
      transcreverAudio: (emp, bytes, mime) => this.muller.transcreverAudio(emp, bytes, mime),
      aoTranscrever: async (texto) => {
        await this.prisma.message
          .update({ where: { id: messageId }, data: { conteudo: `🎤 ${texto}` } })
          .catch(() => undefined);
        this.logger.log(`CONVERSAR_IA: áudio do lead transcrito (msg ${messageId})`);
      },
      aoFalharTranscricao: (m) => this.logger.warn(`CONVERSAR_IA: transcrição falhou: ${m}`),
    });
  }

  /** Lead respondeu — roda 1 turno da IA e avança o fluxo se classificou. */
  async retomar(
    execucaoId: string,
    conversationId: string | null,
    textoLead: string,
    imagemDataUrl?: string,
  ): Promise<void> {
    const execucao = await this.prisma.fluxoExecucao.findUnique({ where: { id: execucaoId } });
    if (!execucao || execucao.status !== 'AGUARDANDO' || !execucao.aguardandoNoId) return;
    if (!execucao.empresaId) return;
    const empresaId = execucao.empresaId;

    // Claim atômico do turno (CAS): 2 mensagens do lead em rajada disparam 2 retomar
    // concorrentes; ambos passariam o guard de status acima (a execução só sai de
    // AGUARDANDO no fim — e no caminho "continua conversa" nem sai). Sem isto a IA roda
    // 2x, o WhatsApp sai 2x e a classificação dispara em dobro. `processandoTurno` é o
    // lock otimista por execução, liberado no finally — ortogonal ao status.
    const claim = await this.prisma.fluxoExecucao.updateMany({
      where: { id: execucaoId, status: 'AGUARDANDO', processandoTurno: false },
      data: { processandoTurno: true, turnoIniciadoEm: new Date() },
    });
    if (claim.count === 0) return; // outro turno já está processando esta execução
    try {
      await this.processarTurno(execucao, empresaId, conversationId, textoLead, imagemDataUrl);
    } finally {
      // Libera o claim sem tocar no status (que pode ter virado EM_EXECUCAO no caminho
      // que classifica e avança). Best-effort.
      await this.prisma.fluxoExecucao
        .updateMany({ where: { id: execucaoId }, data: { processandoTurno: false } })
        .catch(() => undefined);
    }
  }

  /** Corpo de um turno do nó Conversar com IA (já com o claim atômico adquirido). */
  private async processarTurno(
    execucao: FluxoExecucao,
    empresaId: string,
    conversationId: string | null,
    textoLead: string,
    imagemDataUrl?: string,
  ): Promise<void> {
    const execucaoId = execucao.id;
    if (!execucao.aguardandoNoId) return;
    const no = await this.prisma.fluxoNo.findUnique({ where: { id: execucao.aguardandoNoId } });
    if (!no) return;
    const cfg = (no.config ?? {}) as ConversarIaConfig;
    const ctx = execucao.contexto as ExecucaoContexto;
    const leadId = typeof ctx.leadId === 'string' ? ctx.leadId : undefined;
    if (!leadId) return;

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, empresaId },
      select: { contatoTelefone: true, contatoNome: true, contatoEmail: true, variaveis: true },
    });
    if (!lead?.contatoTelefone) return;

    // Captura de e-mail: quando o lead manda um e-mail (ex: pra receber o convite da
    // reunião com o diretor), grava em Lead.contatoEmail se ainda não houver — vira
    // dado estruturado reusável em funis futuros. Regex no texto do lead (não depende
    // da IA extrair certo). `temEmail` diz à IA se ainda precisa pedir o e-mail.
    let temEmail = !!lead.contatoEmail?.trim();
    if (!temEmail) {
      const m = textoLead.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      if (m) {
        await this.prisma.lead
          .update({ where: { id: leadId }, data: { contatoEmail: m[0].toLowerCase() } })
          .catch(() => undefined);
        temEmail = true;
        this.logger.log(`CONVERSAR_IA: e-mail capturado do lead ${leadId}`);
      }
    }

    // Variáveis que a IA pode gravar (nó "Conversar com IA" — spec §2.5).
    const gravaveis = (cfg.variaveisGravadas ?? []).filter(
      (v) => typeof v === 'string' && v.trim().length > 0,
    );
    const systemPrompt =
      interpolate(await this.persona.compilarSystemPromptConversa(empresaId, cfg.promptId), ctx) +
      INSTRUCAO_CLASSIFICACAO +
      (gravaveis.length
        ? `\n- Em "variaveis", grave APENAS estas chaves: ${gravaveis.join(', ')}.`
        : '') +
      (temEmail
        ? '\n[Dado] O e-mail do lead JÁ está registrado — NÃO peça e-mail de novo.'
        : '\n[Dado] Ainda NÃO temos o e-mail do lead. No FECHAMENTO (quando for encerrar/' +
          'classificar), peça o e-mail dele de forma calorosa — pra enviar o convite da reunião ' +
          'com o diretor — e mantenha "classificou":false até recebê-lo; só classifique ' +
          '(classificou:true) DEPOIS de ter o e-mail (ou se o lead recusar dar).');
    // Histórico da conversa = memória da IA no contexto da execução (inclui o
    // opener + os turnos), com fallback pro montarHistorico (execuções antigas).
    // Sem isto a IA não via as próprias mensagens e se reapresentava a cada resposta.
    // Quantas mensagens de histórico a IA considera = config do bot (Persona Bot →
    // "histórico de mensagens", 1..50, default 10). MESMO número que o bot geral usa.
    const limiteHist =
      (await this.persona.obterConfigBot(empresaId).catch(() => null))?.historicoMensagens ??
      HISTORICO_DEFAULT;
    const ctxHist = (ctx as Record<string, unknown>)._iaHistorico;
    const doContexto: HistoricoMsg[] = Array.isArray(ctxHist) ? (ctxHist as HistoricoMsg[]) : [];
    // Fonte da verdade = a conversa REAL do inbox (cobre todas as execuções do lead);
    // o _iaHistorico desta execução entra como reforço (provider que não ecoa). Merge
    // + dedupe → a IA enxerga o pitch já dado mesmo numa execução "amnésica".
    const daConversa = conversationId ? await this.montarHistorico(conversationId, limiteHist) : [];
    let historico = mesclarHistorico(daConversa, doContexto, limiteHist);
    // A mensagem ATUAL do lead já está salva na conversa (foi ela que disparou o
    // retomar) — remove do fim pra não duplicar: ela vai como `mensagem` na chamada.
    if (
      historico.length > 0 &&
      historico[historico.length - 1].role === 'user' &&
      historico[historico.length - 1].content.trim() === textoLead.trim()
    ) {
      historico = historico.slice(0, -1);
    }

    // Teto de custo do bot (por-empresa, pausa até a virada do período): roteia pela
    // saída "erro" em vez de responder. Checado ANTES do teto-de-prompt (que só pede
    // "um instante" e fica esperando — inadequado pra uma pausa longa por orçamento).
    const custoTurno = await this.custo.verificarTeto(empresaId);
    if (custoTurno.bloqueado) {
      await this.rotearParaErro(
        execucaoId,
        no.id,
        ctx,
        'ia_custo_excedido',
        new Error(custoTurno.motivo ?? 'Teto de custo do bot atingido'),
      );
      return;
    }
    if (!(await this.tetoPromptOk(cfg.promptId))) {
      await this.enviarWhatsapp(
        empresaId,
        lead.contatoTelefone,
        'Só um instante, já te respondo. 🙏',
        true, // reativo
      );
      return; // teto de tokens do prompt atingido — não roda a IA agora
    }
    // RAG — anexa catálogo/conhecimento relevantes ao prompt (com guardrails), se o
    // nó pediu. Recupera com base na mensagem do lead (busca semântica + fallback).
    const blocoRag = await this.montarBlocoRag(empresaId, textoLead, cfg);

    let r: { texto: string; tokensIn?: number; tokensOut?: number };
    try {
      r = await this.muller.gerarRespostaIa(
        empresaId,
        systemPrompt + blocoRag,
        textoLead,
        historico,
        imagemDataUrl,
      );
    } catch (err) {
      // Falha da IA: roteia pela saída "erro" e SAI de AGUARDANDO. Antes esse erro
      // era engolido pelo orquestrador e a execução ficava presa em AGUARDANDO.
      await this.rotearParaErro(execucaoId, no.id, ctx, this.tipoErroIa(err), err);
      return;
    }
    await this.registrarUsoPrompt(cfg.promptId, (r.tokensIn ?? 0) + (r.tokensOut ?? 0));
    await this.custo.registrarUso(empresaId, r.tokensIn ?? 0, r.tokensOut ?? 0);
    const turno = parseTurnoIa(r.texto);

    // ── Encerramento/classificação DESTE turno ──────────────────────────────
    // O nó NÃO pode depender só do flag top-level `classificou`: prompts ricos
    // (ex. Reps v1.9) sinalizam o fim gravando nas VARIÁVEIS — `trilho=encerrar`,
    // `pedido_remocao=sim`, `classificacao_final=<rótulo>` — sem setar classificou.
    // Sem reconhecer isso, o nó ficava AGUARDANDO até o timeout de 24h (só o LGPD
    // roteava). Tratamos qualquer SINAL TERMINAL deste turno como classificação —
    // e usamos a classificação deste turno (não valor velho do lead) pra rotear.
    // Rede de segurança LGPD (DETERMINÍSTICA): se o LEAD pediu remoção no texto,
    // força pedido_remocao=sim mesmo que a IA tenha respondido só a despedida sem
    // gravar a variável — senão o nó fica preso em AGUARDANDO e nunca roteia.
    if (pedidoRemocaoNoTexto(textoLead)) {
      turno.variaveis = { ...(turno.variaveis ?? {}), pedido_remocao: 'sim' };
      this.logger.log(
        `CONVERSAR_IA: pedido de remoção detectado no texto do lead ${leadId} — forçando pedido_remocao=sim (exec ${execucaoId})`,
      );
    }

    const vTurno = (turno.variaveis ?? {}) as Record<string, unknown>;
    const norm = (x: unknown): string =>
      String(x ?? '')
        .trim()
        .toLowerCase();
    const classificacaoFinalTurno = String(vTurno.classificacao_final ?? '').trim();
    const sinalEncerramento =
      norm(vTurno.trilho) === 'encerrar' ||
      norm(vTurno.pedido_remocao) === 'sim' ||
      ['sim', 'true', '1'].includes(norm(vTurno.encerrar_conversa)) ||
      classificacaoFinalTurno.length > 0;
    let classificouEfetivo = turno.classificou === true || sinalEncerramento;
    let classificacaoTurno = turno.classificacao ?? (classificacaoFinalTurno || undefined);

    const respostaPersonalizada = personalizarNome(turno.resposta, lead.contatoNome);
    // Tool-use por marcador: a IA pode pedir o envio de arquivos com [[ENVIAR_DOC:id]].
    // Separa o texto (sem as marcações) dos ids; o envio real acontece após o texto.
    const { limpo, ids: docIds } = extrairMarcadoresDoc(respostaPersonalizada);
    const respostaTexto =
      limpo || (docIds.length > 0 ? 'Segue o arquivo solicitado. 📎' : respostaPersonalizada);
    const idemTurno = `fx:${execucaoId}:${no.id}:t${(ctx._iaTurno as number) ?? 0}`;
    try {
      await this.enviarWhatsapp(empresaId, lead.contatoTelefone, respostaTexto, true, idemTurno);
    } catch (err) {
      await this.rotearParaErro(execucaoId, no.id, ctx, 'whatsapp_falha', err);
      return;
    }
    // Depois do texto, manda os arquivos pedidos (best-effort, re-valida podeEnviar).
    await this.enviarDocumentos(empresaId, lead.contatoTelefone, docIds, idemTurno);

    // Atualiza a memória da conversa (pergunta do lead + resposta da IA).
    const novoHist: HistoricoMsg[] = [
      ...historico,
      { role: 'user' as const, content: textoLead, at: Date.now() },
      { role: 'assistant' as const, content: respostaTexto, at: Date.now() },
    ].slice(-limiteHist);

    // Janela de ENCERRAMENTO EDUCADO configurada no nó (ausente/0 = encerra na hora).
    const esperaMs = cfg.encerramentoEspera
      ? unidadeTempoMs(cfg.encerramentoEspera.valor, cfg.encerramentoEspera.unidade)
      : 0;
    const jaClassificou = (ctx as Record<string, unknown>)._iaClassificou === true;

    // REDE DE SEGURANÇA "encerrou por texto sem classificar": se a IA se DESPEDIU
    // (trava anti-loop / "não é o perfil" / "vou te deixar em paz") mas NÃO emitiu
    // classificação NESTE turno, o motor força a classificação com uma chamada
    // dedicada (classificarEncerramento) — em vez de deixar o nó preso em
    // AGUARDANDO. Sem isto, todo Sem Sinergia em que o LLM "esquece" a variável
    // travava o funil. Só roda quando de fato houve despedida (conservador).
    if (!classificouEfetivo && !jaClassificou && respostaEhDespedida(respostaTexto)) {
      const rotulo = await this.classificarEncerramento(empresaId, cfg, novoHist);
      turno.variaveis = { ...(turno.variaveis ?? {}), classificacao_final: rotulo };
      classificacaoTurno = rotulo;
      classificouEfetivo = true;
      this.logger.log(
        `CONVERSAR_IA: IA se despediu sem classificar — fallback classificou "${rotulo}" (lead ${leadId}, exec ${execucaoId})`,
      );
    }

    // Continua a conversa quando: (a) a IA ainda NÃO classificou (segue a entrevista),
    // OU (b) já classificou e está no ENCERRAMENTO EDUCADO (segue respondendo o rep pra
    // fechar com gentileza, SEM re-disparar tag/aviso). Renova o timeout + memória.
    if (!classificouEfetivo || jaClassificou) {
      const renovaMs = jaClassificou ? esperaMs : (cfg.timeoutHoras ?? 24) * 3_600_000;
      await this.prisma.fluxoExecucao.update({
        where: { id: execucaoId },
        data: {
          timeoutEm: new Date(Date.now() + renovaMs),
          // _iaTurno++ persiste pro PRÓXIMO turno ganhar uma chave de idempotência nova
          // (o turno atual usou :t<n>; o reprocesso do mesmo turno reusa :t<n> e deduplica).
          contexto: toJsonInput({
            ...ctx,
            _iaHistorico: novoHist,
            _iaTurno: ((ctx._iaTurno as number) ?? 0) + 1,
          }),
        },
      });
      return;
    }

    // 1ª vez que a IA classifica — grava variáveis no lead e dispara o gatilho.
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
    if (classificacaoTurno) novas.classificacao = classificacaoTurno;
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { variaveis: toJsonInput(novas) },
    });

    await this.bus.disparar(empresaId, 'IA_CLASSIFICOU', {
      leadId,
      classificacao: classificacaoTurno ?? null,
    });

    // SEM janela de encerramento (esperaMs<=0): comportamento clássico — avança o ramo
    // "classificou" na MESMA execução e encerra a conversa do nó de IA.
    if (esperaMs <= 0) {
      await this.prisma.fluxoExecucao.update({
        where: { id: execucaoId },
        data: { status: 'EM_EXECUCAO', aguardandoNoId: null, timeoutEm: null },
      });
      await this.enfileirarSucessores(execucaoId, no.id, 'classificou', true);
      this.logger.log(
        `Execução ${execucaoId} — IA classificou "${classificacaoTurno ?? '?'}" (lead ${leadId})`,
      );
      return;
    }

    // COM janela de encerramento: roda o ramo "classificou" numa execução-FILHA
    // (tag/aviso em paralelo) e mantém o nó de IA AGUARDANDO por `esperaMs` pra um
    // encerramento educado com o rep. Side-effects rodam UMA vez (marca _iaClassificou).
    await this.dispararRamoClassificou(execucao, no.id, ctx);
    await this.prisma.fluxoExecucao.update({
      where: { id: execucaoId },
      data: {
        timeoutEm: new Date(Date.now() + esperaMs),
        contexto: toJsonInput({
          ...ctx,
          _iaHistorico: novoHist,
          _iaClassificou: true,
          classificacao: classificacaoTurno ?? null,
        }),
      },
    });
    this.logger.log(
      `Execução ${execucaoId} — IA classificou "${classificacaoTurno ?? '?'}" (lead ${leadId}); ` +
        `ramo disparado, conversa segue ${Math.round(esperaMs / 1000)}s pro encerramento educado`,
    );
  }

  /**
   * Roda o ramo "classificou" (tag, avisar diretor, etc.) numa execução-FILHA, pra o
   * nó de IA NÃO precisar encerrar a conversa ao classificar — ele segue AGUARDANDO
   * pra um encerramento educado com o rep. A filha copia o contexto e conclui sozinha
   * quando o ramo termina. Sem aresta "classificou" (nem sem-label), não faz nada.
   */
  private async dispararRamoClassificou(
    execucao: { id: string; fluxoId: string; empresaId: string | null },
    noId: string,
    ctx: ExecucaoContexto,
  ): Promise<void> {
    if (!execucao.empresaId) return;
    const arestas = await this.prisma.fluxoEdge.findMany({ where: { sourceNoId: noId } });
    const alvos = arestas.filter((e) => e.label === 'classificou' || !e.label);
    if (alvos.length === 0) return;
    const filha = await this.prisma.fluxoExecucao.create({
      data: {
        fluxoId: execucao.fluxoId,
        empresaId: execucao.empresaId,
        status: 'EM_EXECUCAO',
        iniciouEm: new Date(),
        // _ramoFilha: o supersede anti-duplicata da IA NÃO deve cancelar esta execução
        // (ela já está rodando as ações terminais do ramo "classificou").
        contexto: toJsonInput({ ...ctx, _ramoFilha: true }),
      },
    });
    for (const e of alvos) {
      await this.enfileirarStep(filha.id, e.targetNoId);
    }
  }

  /**
   * Cron — execuções paradas além do timeout. Se o nó tem uma saída "timeout"
   * (aresta com label 'timeout'), CONTINUA o fluxo por ela (ex: nó de follow-up).
   * Senão, mantém o comportamento antigo: dispara LEAD_SEM_RESPOSTA e encerra.
   */
  async processarTimeouts(): Promise<number> {
    const agora = new Date();
    const vencidas = await this.prisma.fluxoExecucao.findMany({
      // SÓ fluxos ATIVOS: pausar/arquivar um fluxo CONGELA as execuções dele
      // (sem isto, um fluxo pausado seguia disparando o ramo "timeout" a cada
      // rodada do cron — bug do "fluxo pausado que continua enviando").
      // processandoTurno:false → não pega execução cujo turno o retomar está processando.
      where: {
        status: 'AGUARDANDO',
        processandoTurno: false,
        timeoutEm: { lt: agora },
        fluxo: { status: 'ATIVO' },
      },
      select: { id: true, empresaId: true, contexto: true, aguardandoNoId: true },
      take: 200,
    });
    let comRamo = 0;
    for (const ex of vencidas) {
      const ctx = ex.contexto as ExecucaoContexto;
      const leadId = typeof ctx.leadId === 'string' ? ctx.leadId : undefined;
      const seguido = typeof ctx._timeoutSeguido === 'number' ? ctx._timeoutSeguido : 0;

      // Encerramento educado expirado: o lead JÁ classificou (a IA só estava fechando a
      // conversa). Conclui em silêncio — NÃO dispara LEAD_SEM_RESPOSTA (ele respondeu) e
      // NÃO segue ramo "timeout" (o ramo "classificou" já rodou na execução-filha).
      if (ctx._iaClassificou === true) {
        await this.prisma.fluxoExecucao.updateMany({
          where: {
            id: ex.id,
            status: 'AGUARDANDO',
            processandoTurno: false,
            timeoutEm: { lt: agora },
          },
          data: {
            status: 'CONCLUIDO',
            aguardandoNoId: null,
            timeoutEm: null,
            terminouEm: new Date(),
          },
        });
        continue;
      }

      const arestasTimeout =
        ex.aguardandoNoId && seguido < MAX_TIMEOUT_FOLLOWS
          ? await this.prisma.fluxoEdge.findMany({
              where: { sourceNoId: ex.aguardandoNoId, label: 'timeout' },
            })
          : [];

      if (arestasTimeout.length > 0) {
        // Continua o fluxo pelo ramo "timeout" (o branch explícito supera o
        // gatilho global LEAD_SEM_RESPOSTA — evita tratar o lead em dobro).
        // _timeoutSeguido conta os re-disparos pra cortar loop (timeout que
        // volta pro mesmo nó com prazo curto = spam a cada rodada do cron).
        // CAS: claim antes de enfileirar — se o retomar pegou o turno ou renovou o
        // timeoutEm, count===0 e o cron NÃO segue o ramo "timeout".
        const claim = await this.prisma.fluxoExecucao.updateMany({
          where: {
            id: ex.id,
            status: 'AGUARDANDO',
            processandoTurno: false,
            timeoutEm: { lt: agora },
          },
          data: {
            status: 'EM_EXECUCAO',
            aguardandoNoId: null,
            timeoutEm: null,
            contexto: toJsonInput({ ...ctx, _timeoutSeguido: seguido + 1 }),
          },
        });
        if (claim.count === 0) continue;
        for (const e of arestasTimeout) {
          await this.enfileirarStep(ex.id, e.targetNoId);
        }
        comRamo++;
        continue;
      }

      // Sem ramo "timeout": CAS antes de tratar como sem-resposta — se o lead respondeu
      // (retomar em curso/renovou o timeout), count===0 e NÃO disparamos LEAD_SEM_RESPOSTA.
      const claim = await this.prisma.fluxoExecucao.updateMany({
        where: {
          id: ex.id,
          status: 'AGUARDANDO',
          processandoTurno: false,
          timeoutEm: { lt: agora },
        },
        data: {
          status: 'CONCLUIDO',
          aguardandoNoId: null,
          timeoutEm: null,
          terminouEm: new Date(),
        },
      });
      if (claim.count === 0) continue;
      if (ex.empresaId && leadId) {
        await this.bus.disparar(ex.empresaId, 'LEAD_SEM_RESPOSTA', { leadId });
      }
    }
    if (vencidas.length > 0) {
      this.logger.log(
        `${vencidas.length} execução(ões) de IA expiraram (${comRamo} seguiram o ramo "timeout")`,
      );
    }
    return vencidas.length;
  }

  /**
   * Limpa os sinais TERMINAIS de roteamento das variáveis do lead (custom) no
   * início de uma nova abordagem — pra a conversa nova não herdar a classificação
   * de uma conversa anterior. Preserva as demais variáveis (tipo_atuacao, etc.).
   */
  private async limparSinaisRoteamento(leadId: string, empresaId: string): Promise<void> {
    // Lista COMPARTILHADA com o montarContexto (remoção do espelho no topo) —
    // divergência entre as duas ressuscitava o sinal velho. Ver SINAIS_ROTEAMENTO.
    const CHAVES = SINAIS_ROTEAMENTO;
    try {
      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, empresaId },
        select: { variaveis: true },
      });
      const v =
        lead?.variaveis && typeof lead.variaveis === 'object'
          ? (lead.variaveis as Record<string, unknown>)
          : {};
      if (!CHAVES.some((k) => k in v)) return; // nada a limpar
      const limpo = { ...v };
      for (const k of CHAVES) delete limpo[k];
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { variaveis: toJsonInput(limpo) },
      });
    } catch {
      /* best-effort — não trava a abordagem */
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────

  /**
   * Envia no WhatsApp do lead respeitando a persona do bot: quando "quebrar em
   * balões" está ligado, manda várias mensagens curtas (mais humano), com
   * "digitando…" e pausa entre elas — mesma lógica do bot do inbox. A IA separa
   * com "|||" (ou parágrafo); o split acontece aqui no envio.
   */
  private async enviarWhatsapp(
    empresaId: string,
    telefone: string,
    texto: string,
    reativo = false,
    idemKey?: string,
  ): Promise<void> {
    if (!texto.trim()) return;
    // Pacing global: espaça este envio dos demais da empresa (nunca tudo de uma vez).
    // `reativo` = resposta a quem escreveu (faixa rápida); opener = proativo (lento).
    await this.pacing.aguardarSlot(empresaId, reativo);
    // Preserva o '+' (E.164) pra o provider distinguir internacional de nacional —
    // senão número estrangeiro de 10/11 dígitos ganharia 55 indevidamente.
    const peerId = `${telefone.replace(/[^\d+]/g, '')}@s.whatsapp.net`;
    const cfg = await this.persona.obterConfigBot(empresaId).catch(() => null);
    // MESMA persona, MESMO helper do bot geral (enviarEmBaloes): balões, delay e
    // "digitando…" idênticos — sem distinção entre fluxo e bot geral. Sem config
    // (erro ao buscar), cai em defaults seguros (sem quebra, sem delay).
    await enviarEmBaloes(
      texto,
      {
        quebrarMensagens: cfg?.quebrarMensagens ?? false,
        maxMensagens: cfg?.maxMensagens ?? 3,
        mostrarDigitando: cfg?.mostrarDigitando ?? false,
        delayRespostaSegundos: cfg?.delayRespostaSegundos ?? 0,
      },
      {
        // Chave de idempotência por balão = posição + hash do CONTEÚDO. Retry com a mesma
        // resposta → mesma chave → o gate da Evolution deduplica (lead não recebe 2×). Mas se
        // o conteúdo do balão mudar entre tentativas (resposta re-gerada), a chave muda e o
        // balão certo sai — antes a chave só-posicional poderia suprimir um balão diferente.
        enviar: (() => {
          let i = 0;
          return (balao: string) => {
            const hash = createHash('sha1').update(balao).digest('hex').slice(0, 12);
            const ctx = idemKey ? { idempotencyKey: `${idemKey}:b${i++}:${hash}` } : {};
            return this.whatsapp.enviarTexto(empresaId, peerId, balao, ctx).then(() => undefined);
          };
        })(),
        digitando: (ms) =>
          void this.whatsapp
            .enviarPresenca(empresaId, peerId, 'composing', ms)
            .catch(() => undefined),
        pausado: () =>
          this.whatsapp.enviarPresenca(empresaId, peerId, 'paused').catch(() => undefined),
      },
    );
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

  private async montarHistorico(
    conversationId: string,
    limite = HISTORICO_DEFAULT,
  ): Promise<HistoricoMsg[]> {
    // Inclui TODOS os tipos (não só TEXT): áudio transcrito (tipo=AUDIO) carrega
    // a resposta do lead no conteudo. Filtrar só TEXT fazia a IA esquecer as
    // respostas em áudio e re-perguntar tudo na entrevista.
    // `limite` = quantas mensagens a empresa configurou (Persona Bot → histórico).
    const msgs = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { criadoEm: 'desc' },
      take: Math.max(1, limite),
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

  /**
   * Classifica um erro da IA em `tipo_erro`. A exceção da OpenAI não é granular,
   * então distinguimos só "sem chave configurada" do resto ("provedor indisponível":
   * erro de API / rate limit / HTTP). O detalhe fino vai sempre em `mensagem_erro`.
   */
  private tipoErroIa(err: unknown): 'ia_sem_chave' | 'ia_indisponivel' {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return /chave|n[ãa]o configurad|api key|configure/.test(msg)
      ? 'ia_sem_chave'
      : 'ia_indisponivel';
  }

  /**
   * Roteia a execução pela saída "erro" do nó "Conversar com IA": grava
   * `tipo_erro`/`mensagem_erro` no contexto (usáveis a jusante via {{tipo_erro}} e
   * {{mensagem_erro}}), tira de AGUARDANDO e segue a aresta com label 'erro'. Sem
   * aresta "erro" ligada, `enfileirarSucessores` encerra como CONCLUÍDO — seguro
   * pra fluxos antigos e conserta o lead que ficava preso em AGUARDANDO quando o
   * `retomar` falhava (erro antes engolido pelo orquestrador).
   */
  private async rotearParaErro(
    execucaoId: string,
    noId: string,
    ctx: ExecucaoContexto,
    tipo_erro: string,
    err: unknown,
  ): Promise<{ tipo_erro: string; mensagem_erro: string }> {
    const mensagem_erro = err instanceof Error ? err.message : String(err);
    this.logger.warn(`CONVERSAR_IA erro (${tipo_erro}) — exec ${execucaoId}: ${mensagem_erro}`);
    await this.prisma.fluxoExecucao.update({
      where: { id: execucaoId },
      data: {
        status: 'EM_EXECUCAO',
        aguardandoNoId: null,
        timeoutEm: null,
        contexto: toJsonInput({ ...ctx, tipo_erro, mensagem_erro }),
      },
    });
    await this.enfileirarSucessores(execucaoId, noId, 'erro', false);
    return { tipo_erro, mensagem_erro };
  }
}
