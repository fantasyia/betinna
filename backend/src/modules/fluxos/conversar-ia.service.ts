import { createHash } from 'node:crypto';
import { diaBrasilia, mesBrasilia } from '@shared/utils/data-brasilia.util';
import { Injectable, Logger } from '@nestjs/common';
import { ForaDaJanelaEnvioError } from '@shared/whatsapp-pacing/whatsapp-pacing.util';
import { WhatsappIndisponivelError } from '@integrations/evolution/whatsapp-indisponivel.error';
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
import { InboxService } from '@modules/inbox/inbox.service';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import { montarSchemaDoTurno, parseVariaveisGravadas } from './variaveis-gravadas.util';
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

/**
 * Quantas vezes REGERAR quando a resposta cai na trava de fala-com-operador.
 * 2 porque o problema é de amostragem, não de prompt: a mesma instrução gerou
 * resposta boa nas 8 rodadas seguintes. Mais que isso vira custo sem ganho.
 */
const REGERAR_MAX = 2;

/** Instrução pra IA abrir a conversa (primeira mensagem) — fluxo PROATIVO. */
const INSTRUCAO_OPENER =
  '\n\n[Tarefa agora] Inicie a conversa com o lead: escreva a PRIMEIRA mensagem de abordagem, ' +
  'curta e natural (estilo WhatsApp). Pode separar em 2-3 mensagens curtas com "|||". ' +
  'Responda apenas com a mensagem, sem aspas nem rótulos.';

/**
 * Instrução do caminho REATIVO — o lead escreveu e este nó é a RESPOSTA.
 *
 * Existe porque o `iniciar()` mandava abrir conversa mesmo quando o fluxo tinha
 * sido disparado POR uma mensagem: o T1 respondia "me conta, o que você
 * precisa?" a quem acabou de dizer o que precisava. Aqui não se abre nada — se
 * responde ao que está no histórico.
 *
 * SÓ COMPORTAMENTO: o formato vem do `INSTRUCAO_CLASSIFICACAO`, que o reativo
 * leva SEMPRE. Antes esta constante terminava com "responda apenas com a
 * mensagem, sem aspas nem rótulos" — texto puro — e isso contradizia o
 * contrato JSON. Foi o que deixou o conserto do 1º turno pela metade: o motor
 * passou a ler `classificou`, mas o prompt daquele turno proibia o formato que
 * produz o campo, então ele vinha `false` por construção.
 *
 * A contagem de balões também saiu: quem manda no `|||` é o contrato (2 a 4).
 * Duas regras diferentes pro mesmo separador é ordem contraditória pro modelo.
 */
const INSTRUCAO_RESPOSTA_COMPORTAMENTO =
  '\n\n[Tarefa agora] O lead ACABOU DE ESCREVER (a mensagem dele é a última do histórico). ' +
  'RESPONDA a ela: trate do que a pessoa disse, sem se reapresentar e sem perguntar o que ela ' +
  'precisa se ela já disse. Curta e natural (estilo WhatsApp).';

/**
 * Instrução de quem ASSUME uma conversa que já estava rolando (C1/C2 depois da
 * triagem, RB/RT por etiqueta).
 *
 * Aqui ninguém "acabou de escrever": o gatilho foi mudança de etapa ou etiqueta,
 * então não existe mensagem do turno — o que existe é HISTÓRICO. Dizer pro
 * modelo que a última fala é do lead seria mentira (a última é a do assistente
 * que encerrou a triagem), e mentira no prompt vira comportamento errado.
 */
const INSTRUCAO_ASSUMINDO =
  '\n\n[Tarefa agora] Você está ASSUMINDO uma conversa JÁ EM ANDAMENTO (o histórico acima é ' +
  'ela). A pessoa JÁ CONTOU o problema dela — leia e continue de onde parou. NUNCA pergunte ' +
  'algo que ela já respondeu, e cite o que ela disse com as palavras dela (o equipamento, o ' +
  'que queimou, quantas vezes) pra ela ver que foi lido. Curta e natural (estilo WhatsApp).';

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

/**
 * Linha que é VAZAMENTO de variável interna, não fala pro cliente:
 * `classificacao_final="Indefinido"`, `trilho: encerrar`, `classificou=false`…
 * (identificador snake_case + = ou : + valor, sozinho na linha).
 *
 * Aconteceu em prod: a IA respondeu a saudação E, na linha seguinte, o
 * `classificacao_final="Indefinido"` — como o conjunto não era JSON válido, o
 * parser devolvia o texto CRU e o cliente recebia a variável como mensagem.
 */
const LINHA_VARIAVEL_VAZADA = /^\s*[a-z_][a-z0-9_]{2,}\s*[=:]\s*.{0,80}$/i;

/** Tira do texto de RESPOSTA as linhas que são variável interna vazada. */
/**
 * A resposta está falando com o OPERADOR em vez do cliente?
 *
 * Existe porque aconteceu duas vezes em produção (24/08): o modelo recebia a
 * sentinela `(inicie)` como se fosse fala do cliente, entrava em contradição com
 * a instrução de "continue a conversa" e pedia AO CLIENTE que colasse o
 * histórico — "cole a primeira mensagem do lead", "me manda o que a pessoa falou
 * por último na conversa acima". Isso foi pro WhatsApp de uma indústria que
 * tinha acabado de relatar um problema.
 *
 * A causa foi corrigida (a sentinela não vai mais como turno), mas a trava fica:
 * texto meta dirigido a quem opera o sistema NUNCA deve chegar ao cliente, venha
 * de onde vier. Melhor não responder do que responder isso.
 *
 * Deliberadamente ESTREITO — casa pedido de histórico/contexto ao interlocutor,
 * não conversa comum. "Me manda o modelo do equipamento" é pergunta legítima e
 * não pode cair aqui.
 */
const PADROES_FALA_COM_OPERADOR: RegExp[] = [
  /\bcole\b[^.?!]{0,40}\b(mensagem|conversa|hist[oó]rico|trecho)\b/i,
  /\b(me\s+(manda|envie|passa)|envie|informe)\b[^.?!]{0,40}\b(hist[oó]rico|conversa\s+(acima|anterior)|o\s+que\s+a\s+pessoa\s+(falou|disse)|primeira\s+mensagem)\b/i,
  /\bconversa\s+j[aá]\s+existente\b/i,
  /\b(pediu|pedir)\s+(para|pra)\s+iniciar\s+uma\s+conversa\b/i,
  /\bn[aã]o\s+(tenho|recebi)\s+(acesso\s+ao|o)\s+hist[oó]rico\b/i,
];

export function falaComOperador(texto: string): boolean {
  return PADROES_FALA_COM_OPERADOR.some((re) => re.test(texto));
}

/**
 * Normaliza a pontuacao que denuncia texto de robo no WhatsApp.
 *
 * Os 7 prompts da empresa ja PROIBEM dois-pontos e travessao no texto pro
 * cliente - e escapava assim mesmo ("me diga em que parte esta a duvida: no
 * modelo, na instalacao..."). Pontuacao e regra de FORMATACAO, nao de
 * julgamento: pedir ao modelo reduz a frequencia e nunca zera, e cada reforco
 * novo compete com as outras regras de um prompt de 29 mil caracteres.
 *
 * URLs e trechos entre crases passam INTACTOS. O link do C1 leva ":" em tres
 * lugares legitimos - o "https:", e o separador rotulo:corrente do parametro
 * "quadros" (ex.: quadros=Freezers / refrigeracao:40). Trocar qualquer um
 * quebra o link e joga o cliente numa pagina vazia: seria trocar um problema
 * cosmetico por um que perde venda.
 *
 * Hora (10:30) tambem fica: ":" entre digitos nao e prosa.
 */
export function normalizarPontuacao(texto: string): string {
  if (!texto) return texto;
  // Recorta o que nao pode ser tocado e devolve no fim.
  const cofre: string[] = [];
  const guardar = (m: string): string => `§§${cofre.push(m) - 1}§§`;
  let t = texto
    .replace(/`[^`]*`/g, guardar)
    .replace(/\bhttps?:\/\/\S+/gi, guardar)
    .replace(/\bwww\.\S+/gi, guardar);

  t = t
    // ":" em prosa vira virgula. Entre digitos (hora, proporcao) fica.
    .replace(/(?<!\d)\s*:\s*(?!\d)/g, ', ')
    // Travessao e meia-risca viram virgula.
    .replace(/\s*[—–]\s*/g, ', ')
    // ";" encerra a frase.
    .replace(/\s*;\s*/g, '. ');

  t = t
    // A troca pode encostar pontuacao: ", ." ou ",," viram um sinal so.
    .replace(/,\s*([,.!?])/g, '$1')
    .replace(/\s+([,.!?])/g, '$1')
    // Depois de ";" -> ".", a frase nova comeca em maiuscula.
    .replace(/\.\s+(\p{Ll})/gu, (_m, c) => `. ${c.toUpperCase()}`)
    .replace(/[ \t]{2,}/g, ' ');

  return t.replace(/§§(\d+)§§/g, (_m, i) => cofre[Number(i)] ?? '');
}

export function limparVazamentoDeVariaveis(texto: string): string {
  const linhas = texto.split(/\r?\n/);
  const uteis = linhas.filter((l) => {
    if (!l.trim()) return true; // preserva parágrafos
    // Só corta se parecer atribuição de variável E não tiver cara de frase
    // (frase real quase sempre tem espaço antes do ":" ou mais texto depois).
    return !(
      LINHA_VARIAVEL_VAZADA.test(l) && !/\s\S+\s\S+\s\S+/.test(l.replace(/^[^=:]*[=:]/, ''))
    );
  });
  return uteis
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
        // Limpa TAMBÉM aqui, não só no fallback: a IA devolve JSON VÁLIDO com o
        // vazamento DENTRO do texto da resposta ("…?\nclassificacao_final = "X"").
        // Foi assim que a variável chegou no WhatsApp do cliente mesmo depois do
        // fix anterior, que só cobria o caminho "não é JSON".
        resposta: normalizarPontuacao(limparVazamentoDeVariaveis(obj.resposta)),
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
  // Fallback texto puro: NUNCA mandar variável interna pro cliente.
  return { resposta: normalizarPontuacao(limparVazamentoDeVariaveis(texto)), classificou: false };
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
/**
 * Tira o prefixo de áudio transcrito ("🎤 ") + trim, pra comparar conteúdo de
 * mensagem. Ver #B8 — o prefixo é decoração de UI, não faz parte do que a pessoa
 * disse; comparar com ele fazia todo áudio escapar do dedup.
 */
export function semMic(s: string): string {
  return s.replace(/^\s*🎤\s*/u, '').trim();
}

/**
 * Aplica a allowlist `variaveisGravadas` do nó, SEMPRE deixando passar os
 * SINAIS DE ROTEAMENTO.
 *
 * Exportada de propósito: a spec anterior reimplementava este filtro dentro do
 * próprio teste e testava a cópia — reverter a linha de produção mantinha a
 * suíte verde. Um teste que não trava nada é pior que nenhum, porque dá
 * confiança falsa.
 */
export function filtrarVariaveisGravaveis(
  gravaveis: string[],
  vars: Record<string, unknown>,
): Record<string, unknown> {
  if (!gravaveis.length) return vars;
  const permitidas = new Set<string>([...gravaveis, ...SINAIS_ROTEAMENTO]);
  return Object.fromEntries(Object.entries(vars).filter(([k]) => permitidas.has(k)));
}

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
    // #B8: mesma normalização do dedup do turno — o eco vindo do contexto não
    // tem o prefixo "🎤 " que a Message ganha ao transcrever, então áudio
    // duplicado escapava por aqui também.
    const mesmaFala = ult && ult.role === m.role && semMic(ult.content) === semMic(m.content);
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
/**
 * Vida do claim de turno. Turno de IA leva segundos; passado disso o lock está
 * morto e outra mensagem pode tomá-lo. É este número — não o cron de 15min —
 * que define quanto tempo o cliente pode ficar sem resposta.
 */
const TTL_CLAIM_MS = 3 * 60 * 1000;

/** Teto de um turno. Existe pra GARANTIR que o `finally` rode e solte o lock. */
const TIMEOUT_TURNO_MS = 2 * 60 * 1000;

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
    private readonly inbox: InboxService,
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
    /** Mesma conversa = mesmo número. Ver `donoDaConversa`. */
    proprietarioId?: string | null,
    /**
     * Execução dona deste envio. Quando informada, o envio é abortado se a
     * execução tiver sido CANCELADA enquanto a IA pensava — ver `execucaoViva`.
     */
    execucaoId?: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    // Mesma trava do texto: documento enviado depois da pausa é a mesma quebra
    // de promessa, só que em anexo.
    if (execucaoId && !(await this.execucaoViva(execucaoId))) {
      this.logger.warn(
        `CONVERSAR_IA: execução ${execucaoId} cancelada — ${ids.length} documento(s) NÃO enviados`,
      );
      return;
    }
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
          {
            idempotencyKey: `${idemBase}:doc:${doc.id}`,
            ...(proprietarioId ? { proprietarioId } : {}),
          },
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
    fluxoId: string,
    historico: HistoricoMsg[],
    /** Nó de IA que está encerrando — define QUAL roteador vale (#B9). */
    noIaId?: string,
    /** Prompt do nó, pra contabilizar os tokens do classificador no teto (#B14). */
    promptId?: string,
  ): Promise<string> {
    const PADRAO = ['Ativar Agora', 'Reaquecer', 'Sem Sinergia'];
    // Rótulos REAIS do roteador DESTE fluxo (variável ~classificacao*): tenant
    // com saídas próprias não ganha mais rótulo alheio que não casa aresta nenhuma.
    //
    // AUDITORIA #B9: pegava o PRIMEIRO roteador do fluxo inteiro. Fluxo com dois
    // nós de IA (ex.: triagem + qualificação), cada um com seu roteador de
    // classificação, classificava o encerramento do 2º com os rótulos do 1º — o
    // rótulo devolvido não casava aresta nenhuma e a execução caía no 'default'.
    // Agora sai do nó ATUAL e segue as arestas; a busca ampla vira só fallback.
    let labels = PADRAO;
    try {
      const [nos, arestas] = await Promise.all([
        this.prisma.fluxoNo.findMany({
          where: { fluxoId, tipo: 'CONDICAO' },
          select: { id: true, config: true },
        }),
        noIaId
          ? this.prisma.fluxoEdge.findMany({
              where: { fluxoId },
              select: { sourceNoId: true, targetNoId: true },
            })
          : Promise.resolve([]),
      ]);
      const ehRoteadorClassif = (
        c: {
          modo?: string;
          variavel?: string;
          saidas?: unknown;
        } | null,
      ) => c?.modo === 'roteador' && /classifica/i.test(c?.variavel ?? '');
      const porId = new Map(
        nos.map((n) => [
          n.id,
          n.config as { modo?: string; variavel?: string; saidas?: unknown } | null,
        ]),
      );

      // BFS a partir do nó de IA: o 1º roteador de classificação ALCANÇÁVEL é o
      // dele. Cap de visitados evita ciclo.
      let rot: { modo?: string; variavel?: string; saidas?: unknown } | null = null;
      if (noIaId && arestas.length > 0) {
        const vizinhos = new Map<string, string[]>();
        for (const e of arestas) {
          const l = vizinhos.get(e.sourceNoId) ?? [];
          l.push(e.targetNoId);
          vizinhos.set(e.sourceNoId, l);
        }
        const vistos = new Set<string>([noIaId]);
        const fila = [...(vizinhos.get(noIaId) ?? [])];
        while (fila.length > 0 && vistos.size < 200) {
          const atual = fila.shift() as string;
          if (vistos.has(atual)) continue;
          vistos.add(atual);
          const cfgNo = porId.get(atual);
          if (cfgNo && ehRoteadorClassif(cfgNo)) {
            rot = cfgNo;
            break;
          }
          fila.push(...(vizinhos.get(atual) ?? []));
        }
      }
      // Fallback: fluxo sem aresta mapeada (ou nó solto) → comportamento antigo.
      rot ??= nos.map((n) => porId.get(n.id) ?? null).find((c) => ehRoteadorClassif(c)) ?? null;

      const saidas = Array.isArray(rot?.saidas)
        ? rot.saidas.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : [];
      if (saidas.length >= 2) labels = saidas;
    } catch {
      /* mantém o padrão */
    }
    // Fallback seguro: o rótulo "pior caso" (convenção: saídas ordenadas da
    // melhor pra pior — no padrão, "Sem Sinergia" → Perdido).
    const fallback = labels.includes('Sem Sinergia') ? 'Sem Sinergia' : labels[labels.length - 1];
    const ehPadrao = labels.length === PADRAO.length && PADRAO.every((l) => labels.includes(l));
    const prompt = ehPadrao
      ? 'Você é um CLASSIFICADOR interno (NÃO fala com o lead). Com base na conversa acima, ' +
        'classifique o LEAD e responda APENAS um JSON {"classificacao_final":"<opção>"}, uma das ' +
        'opções EXATAS:\n' +
        '- "Ativar Agora": tem acesso a indústria E topa representar E já sinalizou oportunidade concreta.\n' +
        '- "Reaquecer": tem perfil de representante mas ainda SEM oportunidade concreta (ou indeciso).\n' +
        '- "Sem Sinergia": NÃO tem acesso a indústria, ou NÃO quer representar, ou não engajou/só zoou.\n' +
        'Na dúvida, ou se o contato não engajou de verdade, use "Sem Sinergia".'
      : 'Você é um CLASSIFICADOR interno (NÃO fala com o lead). Com base na conversa acima, ' +
        'classifique o LEAD e responda APENAS um JSON {"classificacao_final":"<opção>"}, uma das ' +
        `opções EXATAS: ${labels.map((l) => `"${l}"`).join(', ')}.\n` +
        `Na dúvida, ou se o contato não engajou de verdade, use "${fallback}".`;
    try {
      const r = await this.muller.gerarRespostaIa(
        empresaId,
        prompt,
        '(classifique a conversa acima em UMA opção)',
        historico,
      );
      await this.custo.registrarUso(empresaId, r.tokensIn ?? 0, r.tokensOut ?? 0);
      // #B14: esta chamada gastava tokens do prompt e NÃO entrava no teto dele —
      // só no custo da empresa. Com encerramento forçado frequente, o teto diário
      // ficava subcontado e o guard nunca segurava.
      await this.registrarUsoPrompt(promptId, (r.tokensIn ?? 0) + (r.tokensOut ?? 0));
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
        rotulo = labels.find((l) => limpo.toLowerCase().includes(l.toLowerCase())) ?? '';
      }
      return labels.find((l) => l.toLowerCase() === rotulo.toLowerCase()) ?? fallback;
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
    /**
     * O fluxo foi disparado por mensagem do lead (ex: T1 no MENSAGEM_CANAL)?
     * Então esta "abertura" é RESPOSTA a quem acabou de escrever: usa a faixa
     * rápida de pacing e não é segurada pela janela de envio. Fluxo proativo
     * (cron, lead criado, tag) segue como abordagem — e essa sim tem hora.
     */
    reativo = false,
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

    // GATE DO BOT — o "desligado" do dono vale pra TODA IA, não só pro bot geral.
    // Sem isto o fluxo respondia contato com o bot desligado (aconteceu em prod:
    // dono deixou o bot ON só numa conversa, e a triagem respondeu outro contato).
    // Precedência igual à do bot geral: Conversation.botLigado (override por
    // conversa) > Empresa.botWhatsappAtivo (global) > desligado.
    const convIdGate = typeof ctx.conversationId === 'string' ? ctx.conversationId : undefined;
    if (convIdGate) {
      const [empresaCfg, convCfg] = await Promise.all([
        this.prisma.empresa.findUnique({
          where: { id: empresaId },
          select: { botWhatsappAtivo: true },
        }),
        this.prisma.conversation.findUnique({
          where: { id: convIdGate },
          select: { botLigado: true, precisaHumano: true },
        }),
      ]);
      const ligado = convCfg?.botLigado ?? empresaCfg?.botWhatsappAtivo ?? false;
      if (!ligado || convCfg?.precisaHumano) {
        const motivo = !ligado
          ? 'bot desligado nesta conversa (ou no global da empresa)'
          : 'conversa já escalada pra humano (precisaHumano)';
        this.logger.log(`CONVERSAR_IA: ${motivo} — nó pulado (exec ${execucaoId})`);
        return { aguardando: false, pulado: true, motivo };
      }
    }

    // Supressão LGPD: lead com a tag "Não Reabordar - LGPD ⛔" não é abordado.
    // Passa também o TELEFONE: o match por sufixo (D18) pega o caso do lead
    // DUPLICADO (mesma pessoa, outro leadId) em que só a outra cópia tem a tag.
    const leadTel = await this.prisma.lead.findFirst({
      where: { id: leadId, empresaId },
      select: { contatoTelefone: true },
    });
    if (await this.supressao.suprimido(empresaId, { leadId, telefone: leadTel?.contatoTelefone })) {
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
      // `variaveis`: a conclusão da classificação grava POR CIMA das atuais —
      // sem trazer, o 1º turno que classifica apagaria o que o lead já tinha.
      select: { contatoTelefone: true, contatoNome: true, variaveis: true },
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

    // ESPERA SEM FALAR: o nó só registra a espera e devolve o controle.
    //
    // Existe pra deixar montar "IA (acolhe) → texto FIXO (a pergunta) → IA
    // (conduz)". Sem isto o 2º nó de IA falava por cima assim que o fluxo
    // chegava nele e a pergunta fixa virava mensagem órfã — o `aguardarResposta`
    // só age DEPOIS do envio. O ganho é tirar do modelo o que é determinístico:
    // "110V, 220V ou 380V?" é frase fixa, e o modelo a variava entre rodadas com
    // o mesmo prompt.
    //
    // Sai ANTES do teto de custo e da geração: nó que não fala não gasta token.
    if (cfg.naoFalarPrimeiro === true) {
      if (cfg.aguardarResposta === false) {
        // Não fala e não espera = nó que não faz nada. Erro de configuração —
        // falhar aqui é melhor que concluir verde sem ter feito nada.
        throw new Error(
          'Configuração inválida no nó de IA: "não falar primeiro" com "aguardar resposta" ' +
            'desligado — o nó não enviaria nada nem esperaria ninguém.',
        );
      }
      await this.registrarEspera({
        execucaoId,
        noId: no.id,
        ctx,
        empresaId,
        leadId,
        horas: cfg.timeoutHoras ?? 24,
        // Nada a acrescentar na memória: o nó não falou.
        novasFalas: [],
      });
      this.logger.log(
        `CONVERSAR_IA: nó em ESPERA SEM FALAR (exec ${execucaoId}, lead ${leadId}) — ` +
          `nada enviado, aguardando o lead`,
      );
      return { aguardando: true };
    }

    // Isolamento por conversa: zera os sinais de roteamento/encerramento que
    // sobraram de uma abordagem ANTERIOR do mesmo lead. Sem isto, um
    // `classificacao_final` velho poderia rotear a conversa nova (o roteador lê
    // custom.classificacao_final) — a "classificação velha" do card.
    await this.limparSinaisRoteamento(leadId, empresaId);

    // #23: prompt do nó apagado/desativado — não abre conversa com a persona
    // ERRADA só porque o compilador tem fallback. Encerra limpo, com motivo.
    if (await this.promptIndisponivel(empresaId, cfg.promptId)) {
      this.logger.warn(
        `Prompt ${cfg.promptId} indisponível (apagado/desativado) — CONVERSAR_IA pulado (exec ${execucaoId})`,
      );
      return {
        aguardando: false,
        pulado: true,
        motivo: 'prompt do nó não existe ou está desativado — abordagem pulada',
      };
    }

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
    //
    // `usarNomeDoLead: false` desliga isso — usar em INBOUND/triagem, onde o nome
    // vem do PERFIL DO WHATSAPP (apelido/emoji/nome de loja, o que a pessoa pôs
    // lá). Nesses casos a IA recebe uma instrução explícita de NÃO usar nome
    // nenhum: sem ela, o modelo pesca o nome do histórico da conversa e saúda
    // errado do mesmo jeito.
    const usarNome = cfg.usarNomeDoLead !== false;
    const primeiro = usarNome ? primeiroNomeDe(lead.contatoNome) : null;
    // REATIVO = o fluxo foi disparado POR uma mensagem do lead (T1 no
    // MENSAGEM_CANAL, C1/C2/RB/RT assumindo depois da triagem). Este nó é
    // RESPOSTA, não abordagem — e é o que a doc do parâmetro `reativo` sempre
    // disse, mas só o pacing usava.
    // REATIVO leva o CONTRATO JSON ja no 1o turno: e ele que define `classificou`,
    // e sem ele classificar a primeira mensagem e IMPOSSIVEL, nao "dificil".
    // A abordagem FRIA segue em texto puro: la o lead ainda nao falou, nao ha o
    // que classificar, e o contrato so encareceria o turno.
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
    // No REATIVO o modelo tem que RECEBER a fala do lead e o que já foi dito na
    // conversa. Antes ia `'(inicie)'` + histórico `[]` — o texto do cliente
    // estava no contexto (ctx.texto) e simplesmente não era repassado, e o
    // `_iaHistorico` nascia só com o turno do assistant. Efeito: os prompts do
    // C1/C2/RB/RT mandam "não se reapresente" e não tinham como obedecer.
    let mensagemDoTurno = '(inicie)';
    let historicoInicial: HistoricoMsg[] = [];
    /**
     * Assumiu conversa em andamento: veio por etapa/etiqueta, não por mensagem.
     * Não há "mensagem do turno" — todo o contexto está no histórico.
     */
    let assumindoConversa = false;
    if (reativo) {
      const textoLeadCtx =
        typeof (ctx as Record<string, unknown>)['texto'] === 'string'
          ? ((ctx as Record<string, unknown>)['texto'] as string).trim()
          : '';
      const limiteHistIni =
        (await this.persona.obterConfigBot(empresaId).catch(() => null))?.historicoMensagens ??
        HISTORICO_DEFAULT;
      const convIdCtx =
        typeof (ctx as Record<string, unknown>)['conversationId'] === 'string'
          ? ((ctx as Record<string, unknown>)['conversationId'] as string)
          : null;
      // Sem `conversationId` no contexto, acha a conversa pelo LEAD. É o caso do
      // C1/C2 (LEAD_ETAPA_MUDOU) e do RB/RT (LEAD_RECEBEU_TAG): esses eventos
      // carregam o lead, não a conversa — e sem isto o consultivo assumia CEGO,
      // re-perguntando o que o cliente acabara de responder na triagem.
      const convId = convIdCtx ?? (await this.conversaDaEmpresaDoLead(empresaId, leadId));
      historicoInicial = convId
        ? await this.montarHistorico(convId, limiteHistIni, empresaId).catch(() => [])
        : [];
      // Quem ASSUME não tem mensagem-do-turno: ninguém acabou de escrever.
      assumindoConversa = !convIdCtx && !textoLeadCtx && historicoInicial.length > 0;
      if (assumindoConversa) {
        // 🔴 A sentinela `(inicie)` NÃO pode ir como turno do cliente.
        //
        // Ela ia — e o modelo lia como fala real: recebia "o histórico é a
        // conversa, a pessoa já contou o problema" de um lado e `(inicie)` do
        // outro, e NARRAVA a contradição pro cliente ("você acabou de pedir para
        // iniciar uma conversa, mas aqui eu só consigo responder ao conteúdo da
        // conversa já existente", "cole a primeira mensagem do lead"). O bot
        // falando com o operador no WhatsApp de quem acabou de relatar um
        // problema. Aconteceu duas vezes em produção em 24/08.
        //
        // Conserto: quem assume fica IGUAL ao reativo — a última fala do cliente
        // vira o turno e sai do histórico (mesma dedup). O modelo recebe o que
        // recebe no caminho que funciona: histórico + fala do cliente.
        const idxUltimaDoLead = historicoInicial.map((m) => m.role).lastIndexOf('user');
        if (idxUltimaDoLead >= 0) {
          mensagemDoTurno = historicoInicial[idxUltimaDoLead].content;
          historicoInicial = historicoInicial.filter((_, i) => i !== idxUltimaDoLead);
        }
      }
      // A mensagem ATUAL do lead já está na conversa (foi ela que disparou o
      // fluxo): tira do fim pra não ir DUAS vezes — no histórico e como turno.
      // Mesmo cuidado do retomar(), inclusive o áudio com prefixo 🎤.
      //
      // NÃO vale pra quem assume: lá não existe segunda via da mensagem, e tirar
      // a última fala apagaria justamente o que dá o contexto.
      if (
        !assumindoConversa &&
        historicoInicial.length > 0 &&
        historicoInicial[historicoInicial.length - 1].role === 'user' &&
        (!textoLeadCtx ||
          semMic(historicoInicial[historicoInicial.length - 1].content) === semMic(textoLeadCtx))
      ) {
        const ultima = historicoInicial.pop();
        // Sem texto no contexto, a última do histórico É a fala do lead.
        if (!textoLeadCtx && ultima) mensagemDoTurno = ultima.content;
      }
      if (textoLeadCtx) mensagemDoTurno = textoLeadCtx;
    }

    const declaradasAbertura = parseVariaveisGravadas(cfg.variaveisGravadas);
    const opener =
      (reativo
        ? (assumindoConversa ? INSTRUCAO_ASSUMINDO : INSTRUCAO_RESPOSTA_COMPORTAMENTO) +
          INSTRUCAO_CLASSIFICACAO
        : INSTRUCAO_OPENER) +
      (primeiro
        ? `\n[Dado] O primeiro nome do lead é "${primeiro}". Use-o na saudação.`
        : !usarNome
          ? // Sem exemplo de saudação no reativo: o `"Oi! Tudo bem?"` daqui era
            // literalmente o que o cliente recebia depois de descrever o problema
            // dele — o modelo seguia a instrução do MOTOR, não a do prompt.
            '\n[Regra] NÃO use o nome do contato em nenhuma mensagem (o nome do perfil não é confiável).' +
            (reativo ? '' : ' Saúde de forma neutra, ex.: "Oi! Tudo bem?".')
          : '');

    let abertura: { texto: string; tokensIn?: number; tokensOut?: number };
    try {
      abertura = await this.muller.gerarRespostaIa(
        empresaId,
        systemPrompt + opener,
        mensagemDoTurno,
        historicoInicial,
        undefined,
        // O contrato no texto PEDE o JSON; o schema GARANTE. Sem ele o modelo
        // ainda pode devolver texto puro num turno dificil, o parse cai no
        // fallback `classificou:false` e o 1o turno volta a ser cego.
        reativo ? { responseFormat: montarSchemaDoTurno(declaradasAbertura) } : {},
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
    // O opener ia CRU pro cliente: se o modelo devolvesse o JSON do turno (ou um
    // bloco ```json), o lead recebia `{"resposta":"Oi!","classificou":false}` —
    // ou linhas de variável interna vazando. parseTurnoIa cobre os 3 formatos
    // (JSON, cerca, texto puro) e já roda o limparVazamentoDeVariaveis. Como o
    // texto é reusado no _iaHistorico, sanitiza envio E memória de uma vez.
    // O turno INTEIRO, não só `.resposta`: no caminho reativo a IA já pode ter
    // classificado nesta primeira volta, e descartar isso era o que deixava o
    // lead parado na triagem depois de ouvir "já te passo pro comercial".
    let turnoAbertura = parseTurnoIa(abertura.texto);
    let aberturaTexto = personalizarNome(turnoAbertura.resposta, lead.contatoNome);

    // REGERA antes de desistir. `ia_fala_com_operador` diz que ESTA geração saiu
    // ruim, não que o prompt está quebrado — a rodada seguinte, com o mesmo
    // prompt, quase sempre sai boa. Sem isto, UMA rolagem ruim matava a conversa
    // inteira e o lead ficava no silêncio.
    for (let t = 1; t <= REGERAR_MAX && falaComOperador(aberturaTexto); t++) {
      this.logger.warn(
        `CONVERSAR_IA: resposta falava com o operador — regerando (${t}/${REGERAR_MAX}, ` +
          `exec ${execucaoId})`,
      );
      const nova = await this.muller
        .gerarRespostaIa(
          empresaId,
          systemPrompt + opener,
          mensagemDoTurno,
          historicoInicial,
          undefined,
          reativo ? { responseFormat: montarSchemaDoTurno(declaradasAbertura) } : {},
        )
        .catch(() => null);
      if (!nova) break;
      await this.custo.registrarUso(empresaId, nova.tokensIn ?? 0, nova.tokensOut ?? 0);
      turnoAbertura = parseTurnoIa(nova.texto);
      aberturaTexto = personalizarNome(turnoAbertura.resposta, lead.contatoNome);
    }

    // TRAVA: texto dirigido a quem OPERA o sistema não pode ir pro cliente.
    // Melhor não responder do que pedir a uma indústria que "cole a primeira
    // mensagem do lead". Roteia pela saída "erro" — e agora a conversa também
    // sobe no inbox (precisaHumano), então ninguém fica no silêncio.
    if (falaComOperador(aberturaTexto)) {
      this.logger.error(
        `CONVERSAR_IA: resposta falava com o OPERADOR e foi BLOQUEADA (exec ${execucaoId}, ` +
          `lead ${leadId}): "${aberturaTexto.slice(0, 120)}"`,
      );
      const { tipo_erro } = await this.rotearParaErro(
        execucaoId,
        no.id,
        ctx,
        'ia_fala_com_operador',
        new Error('A IA respondeu falando com o operador; nada foi enviado ao cliente.'),
      );
      return { aguardando: false, roteado: true, tipoErro: tipo_erro };
    }
    // MODO SECO do teste: o opener é a primeira mensagem que a pessoa recebe.
    // Num teste contra conversa REAL, mandar isso significa abordar um cliente
    // que não pediu nada — e não tem desfazer. Roda tudo (IA inclusive), só não
    // entrega. Quem quiser entregar marca "enviar de verdade" ao testar.
    const ctxRec = ctx as Record<string, unknown>;
    if (ctxRec['_teste'] === true && ctxRec['_testeEnviaDeVerdade'] !== true) {
      this.logger.log(
        `CONVERSAR_IA em TESTE (exec ${execucaoId}): opener NÃO enviado — "${aberturaTexto.slice(0, 60)}…"`,
      );
      return {
        aguardando: false,
        pulado: true,
        motivo: `TESTE — opener não enviado: ${aberturaTexto}`,
      };
    }

    try {
      await this.enviarWhatsapp(
        empresaId,
        lead.contatoTelefone,
        aberturaTexto,
        reativo,
        `fx:${execucaoId}:${no.id}:opener`,
        this.donoDaConversa(ctx),
        execucaoId,
      );
    } catch (err) {
      // Janela/teto NÃO é falha de WhatsApp — é "ainda não" (auditoria 20/08).
      // O gate do passo passou às 19:59, a IA levou 30s gerando o opener e o
      // aguardarSlot estourou às 20:00: tratar isso como 'whatsapp_falha'
      // mandava a execução pro ramo de ERRO permanente — a regra "janela ADIA,
      // nunca descarta" era violada exatamente na borda. Relança: o executor
      // tem handler dedicado que deleta o claim e REAGENDA com o delay certo.
      if (err instanceof ForaDaJanelaEnvioError) throw err;
      // Instância fora do ar é da MESMA família: "ainda não", não "nunca".
      // Engolir aqui era o que fazia o erro passar por fora do `attempts: 3` do
      // BullMQ — o passo ia pro ramo de erro em 3,4s, sem uma segunda tentativa.
      if (err instanceof WhatsappIndisponivelError) throw err;
      const { tipo_erro } = await this.rotearParaErro(
        execucaoId,
        no.id,
        ctx,
        'whatsapp_falha',
        err,
      );
      return { aguardando: false, roteado: true, tipoErro: tipo_erro };
    }

    // ── CLASSIFICOU JÁ NO 1º TURNO? ────────────────────────────────────────
    // Só no REATIVO: aqui o lead já falou e o modelo já tem tudo — exigir uma
    // segunda mensagem é exigir que a pessoa escreva de novo logo depois de
    // ouvir "já te passo pro comercial", coisa que ninguém faz. Na abordagem
    // FRIA (a IA fala primeiro, o lead ainda não disse nada) continua esperando:
    // classificar ali fecharia o fluxo antes de a pessoa responder.
    if (reativo && turnoAbertura.classificou === true) {
      const esperaIni = cfg.encerramentoEspera
        ? unidadeTempoMs(cfg.encerramentoEspera.valor, cfg.encerramentoEspera.unidade)
        : 0;
      const histIni: HistoricoMsg[] = [
        ...(mensagemDoTurno !== '(inicie)'
          ? [{ role: 'user' as const, content: mensagemDoTurno, at: Date.now() }]
          : []),
        { role: 'assistant' as const, content: aberturaTexto, at: Date.now() },
      ];
      const execIni = await this.prisma.fluxoExecucao.findUnique({
        where: { id: execucaoId },
        select: { id: true, fluxoId: true, empresaId: true },
      });
      if (!execIni) return { aguardando: false };
      await this.concluirClassificacao({
        execucao: execIni,
        noId: no.id,
        ctx,
        empresaId,
        leadId,
        leadVariaveis: lead.variaveis,
        gravaveis: declaradasAbertura.map((v) => v.nome),
        variaveisTurno: turnoAbertura.variaveis ?? {},
        classificacao: turnoAbertura.classificacao,
        historico: histIni,
        esperaMs: esperaIni,
      });
      this.logger.log(
        `CONVERSAR_IA: classificou no 1º turno "${turnoAbertura.classificacao ?? '?'}" ` +
          `(exec ${execucaoId}, lead ${leadId}) — fluxo avança sem esperar 2ª mensagem`,
      );
      return { aguardando: false };
    }

    // Mesma regra no turno de abertura: no REATIVO a pessoa já falou, e o que
    // ela contou na primeira mensagem é justamente o que não pode ser perguntado
    // de novo lá na frente.
    await this.gravarVariaveisDoTurno({
      leadId,
      leadVariaveis: lead.variaveis,
      gravaveis: declaradasAbertura.map((v) => v.nome),
      variaveisTurno: turnoAbertura.variaveis ?? {},
      execucaoId,
    });

    const aguardar = cfg.aguardarResposta ?? true;
    if (!aguardar) return { aguardando: false };

    await this.registrarEspera({
      execucaoId,
      noId: no.id,
      ctx,
      empresaId,
      leadId,
      horas: cfg.timeoutHoras ?? 24,
      novasFalas: [
        ...(reativo && mensagemDoTurno !== '(inicie)'
          ? [{ role: 'user' as const, content: mensagemDoTurno, at: Date.now() }]
          : []),
        { role: 'assistant' as const, content: aberturaTexto, at: Date.now() },
      ],
    });
    this.logger.log(`Execução ${execucaoId} pausada (Conversar com IA) — lead ${leadId}`);
    return { aguardando: true };
  }

  /**
   * Registra a ESPERA do nó: AGUARDANDO + timeout + memória da conversa, e
   * cancela conversas vivas de OUTROS fluxos no mesmo lead.
   *
   * Extraído porque dois caminhos precisam dele: o normal (a IA falou e agora
   * espera) e o `naoFalarPrimeiro` (o nó só espera, sem falar). Duplicar isto
   * significaria duplicar também o cancelamento de órfãs — que é SQL cru com
   * duas correções documentadas em cima.
   */
  private async registrarEspera(p: {
    execucaoId: string;
    noId: string;
    ctx: ExecucaoContexto;
    empresaId: string;
    leadId: string;
    horas: number;
    /** Falas a acrescentar na memória. Vazio quando o nó não falou. */
    novasFalas: HistoricoMsg[];
  }): Promise<void> {
    const { execucaoId, ctx, empresaId, leadId } = p;
    const horas = p.horas;
    const vivaParaEsperar = await this.atualizarSeViva(execucaoId, {
      status: 'AGUARDANDO',
      aguardandoNoId: p.noId,
      timeoutEm: new Date(Date.now() + horas * 3_600_000),
      // Memória da conversa da IA (no contexto da execução): guarda a abertura
      // pra a IA NÃO se reapresentar quando o lead responder. O fluxo manda via
      // whatsapp.enviarTexto (sem gravar na conversa do inbox), então sem isto
      // o montarHistorico não tinha as mensagens do bot → IA repetia o opener.
      contexto: toJsonInput({
        ...ctx,
        // No REATIVO grava os DOIS turnos (a fala do lead + a resposta): a
        // memória tem que refletir a conversa como ela aconteceu, senão o
        // próximo turno lê um diálogo que começa pelo assistant do nada.
        _iaHistorico: [
          ...(Array.isArray(ctx._iaHistorico) ? (ctx._iaHistorico as HistoricoMsg[]) : []),
          ...p.novasFalas,
        ],
      }),
    });
    // Cancelada enquanto o turno rodava: não re-arma a espera nem derruba as
    // conversas de outros fluxos — quem pausou já assumiu o lead.
    if (!vivaParaEsperar) return;
    // AUDITORIA (média): duas conversacionais VIVAS no mesmo lead, em fluxos
    // DIFERENTES, ficavam ambas AGUARDANDO. O supersede do bus é escopado por
    // `fluxoId`, então a antiga (E1) nunca era retomada nem cancelada: esperava
    // o timeout e disparava LEAD_SEM_RESPOSTA no meio da conversa viva do E2 —
    // o lead recebia "sumiu?" enquanto estava respondendo.
    //
    // ⚠️ DUAS CORREÇÕES DA 1ª TENTATIVA (11/08):
    // 1. Estava no TOPO do `iniciar()`, ANTES dos gates de bot desligado, LGPD e
    //    lead sem telefone. Uma execução que seria PULADA já tinha derrubado a
    //    conversa viva do outro fluxo. Agora roda aqui, no ponto em que ESTA
    //    execução de fato entra em AGUARDANDO — só quem vai conversar cancela.
    // 2. Usava `NOT: { contexto: { path: ['_ramoFilha'], equals: true } }`, e o
    //    fluxo-event-bus JÁ DOCUMENTA que esse filtro do Prisma trata chave
    //    AUSENTE como NULL e exclui as execuções-raiz — ou seja, o updateMany
    //    casava ZERO linhas e o cancelamento era no-op. Mesmo remédio de lá:
    //    raw com `IS DISTINCT FROM 'true'::jsonb`.
    const orfas = await this.prisma.$executeRaw`
      UPDATE "FluxoExecucao"
      SET status = 'CANCELADO', "aguardandoNoId" = NULL, "timeoutEm" = NULL, "terminouEm" = now()
      WHERE "empresaId" = ${empresaId}
        AND status = 'AGUARDANDO'
        AND (contexto #>> '{leadId}') = ${leadId}
        AND id <> ${execucaoId}
        AND (contexto #> '{_ramoFilha}') IS DISTINCT FROM 'true'::jsonb`;
    if (orfas > 0) {
      this.logger.log(
        `CONVERSAR_IA: ${orfas} execução(ões) AGUARDANDO de OUTROS fluxos encerradas — ` +
          `conversa nova assume o lead ${leadId} (evita LEAD_SEM_RESPOSTA no meio do papo)`,
      );
    }
    this.logger.log(`Execução ${execucaoId} pausada (Conversar com IA) — lead ${leadId}`);
  }

  /**
   * Conversa da EMPRESA deste lead — pra quem assume sem `conversationId` no
   * contexto (C1/C2 vêm de LEAD_ETAPA_MUDOU, RB/RT de LEAD_RECEBEU_TAG, e esses
   * eventos carregam o LEAD, não a conversa).
   *
   * Sem isso o consultivo começava CEGO: `historicoInicial = []`, e ele
   * re-perguntava o que o cliente tinha acabado de responder na triagem — o
   * oposto do que o prompt do T1 promete ("o robô que assume depois LÊ esta
   * conversa inteira").
   *
   * `proprietarioId: null` NÃO é detalhe: o lead pode ter conversa no WhatsApp
   * da empresa E no pessoal de um rep. A triagem aconteceu na da empresa; pegar
   * a do rep vazaria conversa particular dele pro prompt.
   */
  private async conversaDaEmpresaDoLead(
    empresaId: string,
    leadId?: string | null,
  ): Promise<string | null> {
    if (!leadId) return null;
    const conv = await this.prisma.conversation
      .findFirst({
        where: { empresaId, leadId, canal: 'WHATSAPP', proprietarioId: null },
        orderBy: { ultimaMsgEm: 'desc' },
        select: { id: true },
      })
      .catch(() => null);
    return conv?.id ?? null;
  }

  /** Existe execução pausada (AGUARDANDO) esperando resposta deste lead? */
  async aguardandoPorLead(
    empresaId: string,
    leadId: string,
  ): Promise<{ id: string; proprietarioId: string | null } | null> {
    const ex = await this.prisma.fluxoExecucao.findFirst({
      where: {
        empresaId,
        status: 'AGUARDANDO',
        contexto: { path: ['leadId'], equals: leadId },
      },
      orderBy: { criadoEm: 'desc' },
      select: { id: true, contexto: true },
    });
    if (!ex) return null;
    const ctx = (ex.contexto ?? {}) as Record<string, unknown>;
    // O DONO da conversa que originou a execução — é contra ele que o retomar
    // compara a PORTA por onde a mensagem chegou (ver orquestracao-lead-events).
    const dono =
      typeof ctx['proprietarioId'] === 'string' ? (ctx['proprietarioId'] as string) : null;
    return { id: ex.id, proprietarioId: dono };
  }

  /**
   * TODAS as execuções AGUARDANDO deste lead (qualquer fluxo), da mais nova pra
   * mais velha.
   *
   * AUDITORIA (média): `aguardandoPorLead` devolve só a MAIS RECENTE, e o
   * supersede do bus é escopado por `fluxoId`. Com duas conversacionais vivas no
   * mesmo lead (E1 antigo + E2 novo), a do E1 nunca era retomada nem encerrada:
   * ficava AGUARDANDO até o timeout e disparava LEAD_SEM_RESPOSTA no meio da
   * conversa viva do E2 — o lead recebia "sumiu?" enquanto estava conversando.
   */
  async todasAguardandoPorLead(empresaId: string, leadId: string): Promise<Array<{ id: string }>> {
    return this.prisma.fluxoExecucao.findMany({
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

    // AUDITORIA (#21): a transcrição (Whisper) roda ANTES do `retomar`, e é o
    // `retomar` que checa o teto de custo. Resultado: empresa com o bot pausado
    // por estouro de orçamento continuava PAGANDO Whisper em todo áudio que
    // chegava — o teto que deveria estancar o gasto só barrava a etapa seguinte.
    // Com o teto batido, entrega o conteúdo cru: a mensagem ainda vira o ramo de
    // erro do fluxo (tarefa/humano), só que sem gerar custo novo.
    const teto = await this.custo.verificarTeto(params.empresaId).catch(() => null);
    if (teto?.bloqueado) {
      this.logger.warn(
        `CONVERSAR_IA: teto de custo batido (${params.empresaId}) — pulando transcrição/visão`,
      );
      return { mensagemIA: params.conteudo };
    }
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
    //
    // O claim tem TTL PRÓPRIO. Antes, um turno que não voltasse (sem erro, sem
    // log, sem entrada no FluxoExecucaoLog) prendia o lock até o reaper passar:
    // 15min de TTL + cron de 15min = **até 30 minutos de silêncio** com o bot
    // ligado, o cliente falando e ninguém respondendo. Medido em produção
    // (29/08): 23 minutos. Turno de IA leva segundos, então um lock com mais de
    // TTL_CLAIM_MS está morto e pode ser tomado — sem depender de cron nenhum.
    const claim = await this.prisma.fluxoExecucao.updateMany({
      where: {
        id: execucaoId,
        status: 'AGUARDANDO',
        OR: [
          { processandoTurno: false },
          { turnoIniciadoEm: { lt: new Date(Date.now() - TTL_CLAIM_MS) } },
        ],
      },
      data: { processandoTurno: true, turnoIniciadoEm: new Date() },
    });
    if (claim.count === 0) {
      // A mensagem que PERDE o claim era descartada em silêncio: numa rajada
      // ("oi" + "tudo bem?" em 1s), o 2º recado nunca virava turno e a IA
      // respondia só o primeiro. Quem perde o claim não processa AGORA (senão
      // roda em dobro) — o vencedor varre as mensagens novas no finally.
      const idade = Date.now() - (execucao.turnoIniciadoEm?.getTime() ?? Date.now());
      if (idade > TTL_CLAIM_MS / 2) {
        // Lock velho e ainda de pé é sintoma, não rotina: quem investiga precisa
        // ver isso em produção, e `debug` não aparece lá.
        this.logger.warn(
          `CONVERSAR_IA: claim negado na exec ${execucaoId} com lock de ${Math.round(idade / 1000)}s ` +
            '— turno anterior demorando ou preso',
        );
      } else {
        this.logger.debug(
          `CONVERSAR_IA: turno concorrente na exec ${execucaoId} — o vencedor vai varrer as novas`,
        );
      }
      return;
    }
    const inicioDoTurno = new Date();
    try {
      // Timeout que GARANTE o finally. A causa raiz do lock preso é um turno que
      // nunca se resolve — nem sucesso, nem erro. Promise pendurada não roda
      // `finally`, e é assim que o lock some do radar. Com a corrida, o pior
      // caso vira "um turno perdido", não "a conversa muda".
      await Promise.race([
        this.processarTurno(execucao, empresaId, conversationId, textoLead, imagemDataUrl),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`turno excedeu ${TIMEOUT_TURNO_MS / 1000}s`)),
            TIMEOUT_TURNO_MS,
          ).unref?.(),
        ),
      ]);
    } catch (err) {
      // Não relança: o turno falho não pode derrubar quem chamou (o inbound já
      // foi respondido do ponto de vista do WhatsApp). O que importa é liberar o
      // lock e deixar rastro.
      this.logger.error(
        `CONVERSAR_IA: turno falhou na exec ${execucaoId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      // Libera o claim sem tocar no status (que pode ter virado EM_EXECUCAO no caminho
      // que classifica e avança). Best-effort.
      await this.prisma.fluxoExecucao
        .updateMany({ where: { id: execucaoId }, data: { processandoTurno: false } })
        .catch(() => undefined);
    }
    // Chegou mensagem do lead DURANTE o turno? Processa agora (a que perdeu o
    // claim lá em cima). Guardas: só se a execução ainda está AGUARDANDO (se
    // classificou e avançou, não há mais turno) e uma passada só — o próprio CAS
    // protege a recursão de virar loop.
    if (conversationId) {
      await this.processarMensagensPerdidas(
        execucaoId,
        empresaId,
        conversationId,
        inicioDoTurno,
      ).catch((err) =>
        this.logger.warn(
          `CONVERSAR_IA: varredura pós-turno falhou (exec ${execucaoId}): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  /**
   * Varre as mensagens sem resposta de uma execução destravada.
   *
   * Existe pro reaper: destravar o lock, sozinho, é recuperação só no papel —
   * as mensagens que o cliente mandou enquanto o turno estava preso continuavam
   * sem resposta, porque a varredura só rodava no `finally` de um turno bem
   * sucedido. Quem mandava duas mensagens e desistia nunca era respondido.
   */
  async varrerPendentesAposDestravar(execucaoId: string): Promise<boolean> {
    const execucao = await this.prisma.fluxoExecucao.findFirst({
      where: { id: execucaoId, status: 'AGUARDANDO' },
      select: { id: true, empresaId: true, contexto: true, turnoIniciadoEm: true },
    });
    if (!execucao?.empresaId) return false;
    const ctx = (execucao.contexto ?? {}) as ExecucaoContexto;
    const conversationId = typeof ctx.conversationId === 'string' ? ctx.conversationId : null;
    if (!conversationId) return false;
    // Janela: desde o início do turno que travou — é exatamente o intervalo em
    // que o cliente falou e ninguém respondeu.
    const desde = execucao.turnoIniciadoEm ?? new Date(Date.now() - TTL_CLAIM_MS);
    await this.processarMensagensPerdidas(execucaoId, execucao.empresaId, conversationId, desde);
    return true;
  }

  /**
   * Recolhe mensagens do lead que chegaram DURANTE o turno (perderam o claim) e
   * roda um turno extra com elas. Sem isso, mensagem em rajada ficava sem
   * resposta e o lead achava que o bot travou.
   */
  private async processarMensagensPerdidas(
    execucaoId: string,
    empresaId: string,
    conversationId: string,
    desde: Date,
  ): Promise<void> {
    const aindaAguardando = await this.prisma.fluxoExecucao.findFirst({
      where: { id: execucaoId, status: 'AGUARDANDO' },
      select: { id: true },
    });
    if (!aindaAguardando) return;

    const novas = await this.prisma.message.findMany({
      where: {
        conversationId,
        direction: 'INBOUND',
        criadoEm: { gt: desde },
      },
      orderBy: { criadoEm: 'asc' },
      select: { conteudo: true },
      take: 5,
    });
    const texto = novas
      .map((m) => (m.conteudo ?? '').trim())
      .filter(Boolean)
      .join('\n');
    if (!texto) return;

    this.logger.log(
      `CONVERSAR_IA: ${novas.length} mensagem(ns) chegaram durante o turno — processando agora ` +
        `(exec ${execucaoId})`,
    );
    await this.retomar(execucaoId, conversationId, texto);
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

    // GATE DO BOT também no RETOMAR — o mesmo do iniciar(). Sem isto, depois que
    // a execução entrava em AGUARDANDO, desligar o bot na conversa ou o operador
    // assumir (precisaHumano) não tinha efeito: a IA seguia respondendo e
    // disputava a conversa com o humano. Mantém AGUARDANDO renovando o timeout
    // (sem tocar _iaHistorico/_iaTurno) — religou o bot, a conversa retoma na
    // próxima mensagem do lead.
    if (conversationId) {
      const [empresaCfg, convCfg] = await Promise.all([
        this.prisma.empresa.findUnique({
          where: { id: empresaId },
          select: { botWhatsappAtivo: true },
        }),
        this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { botLigado: true, precisaHumano: true },
        }),
      ]);
      const ligado = convCfg?.botLigado ?? empresaCfg?.botWhatsappAtivo ?? false;
      if (!ligado || convCfg?.precisaHumano) {
        const motivo = !ligado
          ? 'bot desligado nesta conversa (ou no global da empresa)'
          : 'conversa escalada pra humano (precisaHumano)';
        this.logger.log(`CONVERSAR_IA: ${motivo} — turno NÃO processado (exec ${execucaoId})`);
        await this.prisma.fluxoExecucao
          .update({
            where: { id: execucaoId },
            data: { timeoutEm: new Date(Date.now() + (cfg.timeoutHoras ?? 24) * 3_600_000) },
          })
          .catch(() => undefined);
        return;
      }
    }

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
    // Cada entrada pode declarar os VALORES aceitos (`nome: A | B | C`), que
    // viram enum no structured output.
    const declaradas = parseVariaveisGravadas(cfg.variaveisGravadas);
    const gravaveis = declaradas.map((v) => v.nome);
    const systemPrompt =
      interpolate(await this.persona.compilarSystemPromptConversa(empresaId, cfg.promptId), ctx) +
      INSTRUCAO_CLASSIFICACAO +
      // O enum já IMPEDE valor fora da lista; repetir no texto melhora a ESCOLHA
      // (o modelo vê as opções ao decidir, não só ao serializar) e mantém o
      // prompt legível pra quem for revisar o fluxo.
      declaradas
        .filter((v) => v.valores?.length)
        .map(
          (v) => `
- "${v.nome}" aceita EXATAMENTE um destes: ${(v.valores ?? []).join(' | ')}.`,
        )
        .join('') +
      (gravaveis.length
        ? `\n- Em "variaveis", grave APENAS estas chaves: ${gravaveis.join(', ')}.`
        : '') +
      (temEmail
        ? '\n[Dado] O e-mail do lead JÁ está registrado — NÃO peça e-mail de novo.'
        : '\n[Dado] Ainda NÃO temos o e-mail do lead. No FECHAMENTO (quando for encerrar/' +
          'classificar), peça o e-mail dele de forma calorosa — pra enviar o convite da reunião ' +
          'com o diretor — e mantenha "classificou":false até recebê-lo; só classifique ' +
          '(classificou:true) DEPOIS de ter o e-mail (ou se o lead recusar dar).') +
      // Vale em TODO turno, não só na abertura: sem repetir a regra aqui, a IA
      // pescava o nome do histórico e voltava a chamar o contato pelo apelido do
      // perfil do WhatsApp a partir da 2ª mensagem.
      (cfg.usarNomeDoLead === false
        ? '\n[Regra] NÃO use o nome do contato em nenhuma mensagem (o nome do perfil não é confiável).'
        : '');
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
    const daConversa = conversationId
      ? await this.montarHistorico(conversationId, limiteHist, empresaId)
      : [];
    let historico = mesclarHistorico(daConversa, doContexto, limiteHist);
    // A mensagem ATUAL do lead já está salva na conversa (foi ela que disparou o
    // retomar) — remove do fim pra não duplicar: ela vai como `mensagem` na chamada.
    //
    // AUDITORIA #B8: a comparação era literal, mas ÁUDIO transcrito é gravado na
    // Message com prefixo "🎤 " (aoTranscrever) enquanto `textoLead` chega sem
    // ele. Nenhum áudio casava, e o mesmo recado ia DUAS vezes pro modelo — uma
    // no histórico, outra como mensagem do turno. Além do custo, o bot lia como
    // se a pessoa tivesse repetido e respondia estranho.
    if (
      historico.length > 0 &&
      historico[historico.length - 1].role === 'user' &&
      semMic(historico[historico.length - 1].content) === semMic(textoLead)
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
    if (await this.promptIndisponivel(empresaId, cfg.promptId)) {
      await this.rotearParaErro(
        execucaoId,
        no.id,
        ctx,
        'prompt_indisponivel',
        new Error(`Prompt ${cfg.promptId} não existe, foi desativado ou é de outra empresa`),
      );
      return;
    }
    if (!(await this.tetoPromptOk(cfg.promptId))) {
      // O "já te respondo" era uma PROMESSA que ninguém cumpria: o teto do
      // prompt dura até a virada do dia/mês, quase sempre mais que o timeout que
      // ficou correndo — a execução expirava pelo ramo de timeout e o lead nunca
      // recebia resposta. Trata igual ao teto de custo logo acima: avisa o lead e
      // ROTEIA pela saída de erro, pra o fluxo decidir (tarefa/humano).
      await this.enviarWhatsapp(
        empresaId,
        lead.contatoTelefone,
        'Só um instante, já te respondo. 🙏',
        true, // reativo
        undefined, // sem idemKey: aviso pontual
        this.donoDaConversa(ctx),
        execucaoId,
      ).catch(() => undefined);
      await this.rotearParaErro(
        execucaoId,
        no.id,
        ctx,
        'ia_teto_prompt',
        new Error('Teto de tokens do prompt atingido'),
      );
      return;
    }
    // RAG — anexa catálogo/conhecimento relevantes ao prompt (com guardrails), se o
    // nó pediu. Recupera com base na mensagem do lead (busca semântica + fallback).
    const blocoRag = await this.montarBlocoRag(empresaId, textoLead, cfg);

    // Overrides do prompt do nó. Best-effort: sem prompt (ou erro de leitura), a
    // chamada segue com o modelo da empresa, que é o comportamento de sempre.
    const prompt = cfg.promptId
      ? await this.prisma.botPrompt
          .findFirst({
            where: { id: cfg.promptId, empresaId },
            select: { modelo: true, temperatura: true },
          })
          .catch(() => null)
      : null;

    let r: { texto: string; tokensIn?: number; tokensOut?: number };
    try {
      r = await this.muller.gerarRespostaIa(
        empresaId,
        systemPrompt + blocoRag,
        textoLead,
        historico,
        imagemDataUrl,
        {
          // O prompt do nó manda no modelo e na temperatura (antes isso era
          // ignorado e valia sempre a persona da empresa).
          modelo: prompt?.modelo,
          temperatura: prompt?.temperatura == null ? null : Number(prompt.temperatura),
          // Enum das variáveis declaradas: o modelo deixa de PODER responder
          // fora da lista, em vez de a gente torcer pra que não responda.
          responseFormat: montarSchemaDoTurno(declaradas),
        },
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
    const respostaPersonalizada = personalizarNome(turno.resposta, lead.contatoNome);

    // `classificacao_final` SOZINHA não encerra mais a conversa. O modelo às
    // vezes preenche a variável no 1º turno (ex.: "Indefinido") só por estar no
    // schema — e a entrevista morria na largada, com o lead classificado errado.
    // Só vale como terminal com outro sinal junto: a IA declarou classificou,
    // um trilho terminal, ou a resposta ser de fato uma despedida.
    const sinalExplicito =
      norm(vTurno.trilho) === 'encerrar' ||
      norm(vTurno.pedido_remocao) === 'sim' ||
      ['sim', 'true', '1'].includes(norm(vTurno.encerrar_conversa));
    const classificacaoFinalConfiavel =
      classificacaoFinalTurno.length > 0 &&
      (turno.classificou === true || sinalExplicito || respostaEhDespedida(respostaPersonalizada));
    if (classificacaoFinalTurno.length > 0 && !classificacaoFinalConfiavel) {
      this.logger.log(
        `CONVERSAR_IA: classificacao_final="${classificacaoFinalTurno}" no meio da conversa sem ` +
          `sinal de encerramento — IGNORADA (exec ${execucaoId}, lead ${leadId})`,
      );
      delete (turno.variaveis as Record<string, unknown> | undefined)?.classificacao_final;
    }
    const sinalEncerramento = sinalExplicito || classificacaoFinalConfiavel;
    let classificouEfetivo = turno.classificou === true || sinalEncerramento;
    let classificacaoTurno =
      turno.classificacao ??
      (classificacaoFinalConfiavel ? classificacaoFinalTurno || undefined : undefined);

    // Tool-use por marcador: a IA pode pedir o envio de arquivos com [[ENVIAR_DOC:id]].
    // Separa o texto (sem as marcações) dos ids; o envio real acontece após o texto.
    if (falaComOperador(respostaPersonalizada)) {
      this.logger.error(
        `CONVERSAR_IA: resposta falava com o OPERADOR e foi BLOQUEADA (exec ${execucaoId}, ` +
          `lead ${leadId}): "${respostaPersonalizada.slice(0, 120)}"`,
      );
      await this.rotearParaErro(
        execucaoId,
        no.id,
        ctx,
        'ia_fala_com_operador',
        new Error('A IA respondeu falando com o operador; nada foi enviado ao cliente.'),
      );
      return;
    }

    const { limpo, ids: docIds } = extrairMarcadoresDoc(respostaPersonalizada);
    const respostaTexto =
      limpo || (docIds.length > 0 ? 'Segue o arquivo solicitado. 📎' : respostaPersonalizada);
    const idemTurno = `fx:${execucaoId}:${no.id}:t${(ctx._iaTurno as number) ?? 0}`;
    try {
      await this.enviarWhatsapp(
        empresaId,
        lead.contatoTelefone,
        respostaTexto,
        true,
        idemTurno,
        this.donoDaConversa(ctx),
        execucaoId,
      );
    } catch (err) {
      // Mesma regra do opener: porta fechada sobe pro executor (retry +
      // reagendamento); erro permanente segue pro ramo de erro aqui mesmo.
      if (err instanceof ForaDaJanelaEnvioError) throw err;
      if (err instanceof WhatsappIndisponivelError) throw err;
      await this.rotearParaErro(execucaoId, no.id, ctx, 'whatsapp_falha', err);
      return;
    }
    // Depois do texto, manda os arquivos pedidos (best-effort, re-valida podeEnviar).
    await this.enviarDocumentos(
      empresaId,
      lead.contatoTelefone,
      docIds,
      idemTurno,
      this.donoDaConversa(ctx),
      execucaoId,
    );

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
      const rotulo = await this.classificarEncerramento(
        empresaId,
        execucao.fluxoId,
        novoHist,
        no.id,
        cfg.promptId,
      );
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
      // O que a pessoa contou NESTE turno vale mesmo que a conversa siga: é
      // isto que permite a um fluxo disparado depois saber o que a triagem
      // ouviu, em vez de perguntar de novo.
      await this.gravarVariaveisDoTurno({
        leadId,
        leadVariaveis: lead.variaveis,
        gravaveis,
        variaveisTurno: turno.variaveis ?? {},
        execucaoId,
      });
      const renovaMs = jaClassificou ? esperaMs : (cfg.timeoutHoras ?? 24) * 3_600_000;
      const continua = await this.atualizarSeViva(execucaoId, {
        timeoutEm: new Date(Date.now() + renovaMs),
        // _iaTurno++ persiste pro PRÓXIMO turno ganhar uma chave de idempotência nova
        // (o turno atual usou :t<n>; o reprocesso do mesmo turno reusa :t<n> e deduplica).
        contexto: toJsonInput({
          ...ctx,
          _iaHistorico: novoHist,
          _iaTurno: ((ctx._iaTurno as number) ?? 0) + 1,
        }),
      });
      // `continua` só existe pra deixar explícito no log que a execução foi
      // cancelada no meio do turno; o caminho é o mesmo (encerrar aqui).
      void continua;
      return;
    }

    await this.concluirClassificacao({
      execucao,
      noId: no.id,
      ctx,
      empresaId,
      leadId,
      leadVariaveis: lead.variaveis,
      gravaveis,
      variaveisTurno: turno.variaveis ?? {},
      classificacao: classificacaoTurno,
      historico: novoHist,
      esperaMs,
    });
  }

  /**
   * Grava no lead as variáveis capturadas NESTE turno — na hora, sem esperar a
   * classificação.
   *
   * Antes, `variaveisGravadas` só era persistida quando a IA classificava. Toda
   * captura no MEIO da conversa era jogada fora: a pessoa dizia "é 220V e o
   * disjuntor é 100A" no segundo turno, a IA anotava certinho, e o valor sumia
   * com o fim do turno. Só reaparecia se o turno final repetisse a informação —
   * ou, pior, quando o fluxo SEGUINTE perguntava tudo de novo e capturava por
   * conta própria.
   *
   * O efeito colateral era invisível e caro: como `{{custom.*}}` é remontado a
   * partir de `Lead.variaveis` a cada nó, um fluxo disparado no mesmo turno
   * (T1 move a etapa → C1 acorda em LEAD_ETAPA_MUDOU) lia VAZIO. Nenhuma
   * CONDICAO conseguia rotear pelo que a triagem tinha acabado de ouvir, e o
   * cliente repetia o que já havia dito.
   *
   * Escreve só quando algo MUDA de verdade: turno sem captura nova não vira
   * UPDATE, e o lead não ganha uma linha de histórico a cada mensagem.
   *
   * @returns o estado novo das variáveis (ou o atual, quando nada mudou).
   */
  private async gravarVariaveisDoTurno(p: {
    leadId: string;
    leadVariaveis: unknown;
    gravaveis: string[];
    variaveisTurno: Record<string, unknown>;
    execucaoId: string;
    /** Só no fechamento: carimba `classificacao` junto, na mesma escrita. */
    classificacao?: string;
  }): Promise<Record<string, unknown>> {
    const atuais =
      p.leadVariaveis && typeof p.leadVariaveis === 'object'
        ? (p.leadVariaveis as Record<string, unknown>)
        : {};
    const gravadas = filtrarVariaveisGravaveis(p.gravaveis, p.variaveisTurno ?? {});
    // Vazio e string vazia não apagam o que já existe: a IA repetir o schema
    // com os campos em branco é comum, e sobrescrever com nada apagaria a
    // captura de um turno anterior.
    const novasChaves = Object.entries(gravadas).filter(
      ([k, v]) => v != null && String(v).trim() !== '' && atuais[k] !== v,
    );
    if (novasChaves.length === 0 && !p.classificacao) return atuais;

    const novas = {
      ...atuais,
      ...Object.fromEntries(novasChaves),
      ...(p.classificacao ? { classificacao: p.classificacao } : {}),
    };
    await this.prisma.lead.update({
      where: { id: p.leadId },
      data: { variaveis: toJsonInput(novas) },
    });
    const oQue = [
      ...novasChaves.map(([k]) => k),
      ...(p.classificacao ? [`classificacao=${p.classificacao}`] : []),
    ].join(', ');
    this.logger.log(`CONVERSAR_IA: gravado no lead ${p.leadId} (${oQue}) — exec ${p.execucaoId}`);
    return novas;
  }

  /**
   * Conclusão da classificação: grava as variáveis no lead, dispara
   * IA_CLASSIFICOU e avança o ramo "classificou" (na hora, ou por execução-filha
   * quando há janela de encerramento educado).
   *
   * Vive fora do `processarTurno` porque DOIS caminhos precisam dela: o turno
   * seguinte (lead respondeu) e o PRIMEIRO turno reativo — que classificava,
   * pagava os tokens e jogava o resultado fora, deixando o lead parado na
   * triagem depois de ouvir "já te passo pro comercial". Extraída em vez de
   * duplicada: a lógica de "avança se classificou" já era o tipo de coisa que
   * diverge entre cópias.
   */
  private async concluirClassificacao(p: {
    execucao: { id: string; fluxoId: string; empresaId: string | null };
    noId: string;
    ctx: ExecucaoContexto;
    empresaId: string;
    leadId: string;
    leadVariaveis: unknown;
    gravaveis: string[];
    variaveisTurno: Record<string, unknown>;
    classificacao?: string;
    historico: HistoricoMsg[];
    esperaMs: number;
  }): Promise<void> {
    const { execucao, ctx, empresaId, leadId, gravaveis, esperaMs } = p;
    const execucaoId = execucao.id;
    const no = { id: p.noId };
    const lead = { variaveis: p.leadVariaveis };
    const turno = { variaveis: p.variaveisTurno };
    const classificacaoTurno = p.classificacao;
    const novoHist = p.historico;

    // 1ª vez que a IA classifica — grava variáveis no lead e dispara o gatilho.
    //
    // Passa pelo MESMO caminho das capturas do meio da conversa: uma regra só
    // pro que entra em `Lead.variaveis`. Ali dentro ficam as duas garantias que
    // importam — os SINAIS DE ROTEAMENTO passam sempre (mesmo fora da allowlist
    // do nó, porque boa parte é forçada pelo próprio motor: `pedido_remocao`
    // quando o lead pede pra sair, `classificacao_final` no fallback de
    // despedida), e valor VAZIO não apaga captura antiga (a IA repetir o schema
    // em branco no turno final não pode zerar o que ela anotou antes).
    await this.gravarVariaveisDoTurno({
      leadId,
      leadVariaveis: lead.variaveis,
      gravaveis,
      variaveisTurno: turno.variaveis ?? {},
      execucaoId,
      classificacao: classificacaoTurno,
    });

    // `_hops` propaga o corta-loop do bus (auditoria 20/08): este é um
    // re-disparo INTERNO — sem o contador, uma cadeia IA_CLASSIFICOU → fluxo →
    // CONVERSAR_IA → IA_CLASSIFICOU nunca era cortada.
    const hopsClassificou = typeof ctx['_hops'] === 'number' ? (ctx['_hops'] as number) : 0;
    await this.bus.disparar(empresaId, 'IA_CLASSIFICOU', {
      leadId,
      classificacao: classificacaoTurno ?? null,
      _hops: hopsClassificou + 1,
      ...(ctx['_teste'] === true ? { _teste: true } : {}),
    });

    // SEM janela de encerramento (esperaMs<=0): comportamento clássico — avança o ramo
    // "classificou" na MESMA execução e encerra a conversa do nó de IA.
    if (esperaMs <= 0) {
      const seguiuViva = await this.atualizarSeViva(execucaoId, {
        status: 'EM_EXECUCAO',
        aguardandoNoId: null,
        timeoutEm: null,
        // O histórico TEM que ser persistido também aqui. Este caminho gravava
        // só o status, e quem classificava no 1º turno terminava com
        // `_iaHistorico` VAZIO: ficava impossível auditar o que o bot disse —
        // a conversa do inbox não tem a saída do fluxo, e a execução também
        // não tinha. O ramo com janela de encerramento (abaixo) já gravava.
        contexto: toJsonInput({ ...ctx, _iaHistorico: novoHist }),
      });
      // Cancelada no meio do turno: não avança o grafo. Era daqui que saía a
      // SEGUNDA tarefa pro mesmo recado, depois de o envio já ter sido barrado.
      if (!seguiuViva) return;
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
    await this.atualizarSeViva(execucaoId, {
      timeoutEm: new Date(Date.now() + esperaMs),
      contexto: toJsonInput({
        ...ctx,
        _iaHistorico: novoHist,
        _iaClassificou: true,
        classificacao: classificacaoTurno ?? null,
      }),
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
        // Mesmo motivo do IA_CLASSIFICOU acima: re-disparo interno propaga
        // `_hops`, senão o corta-loop do bus não enxerga a cadeia.
        const hops = typeof ctx['_hops'] === 'number' ? (ctx['_hops'] as number) : 0;
        await this.bus.disparar(ex.empresaId, 'LEAD_SEM_RESPOSTA', {
          leadId,
          _hops: hops + 1,
          ...(ctx['_teste'] === true ? { _teste: true } : {}),
        });
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

  /**
   * Dono da conversa que originou a execução (instância pessoal do rep) — ou
   * null quando a mensagem entrou pelo número da empresa.
   *
   * O nó CONVERSAR_IA manda por TELEFONE, não pela conversa, então sem isto ele
   * perdia por onde a conversa chegou e respondia sempre pela empresa. Como ele
   * conduz o diálogo INTEIRO (abertura, cada turno, documentos), era o pedaço
   * que mais fazia o cliente ver dois números na mesma conversa.
   */
  private donoDaConversa(ctx: ExecucaoContexto): string | null {
    const v = (ctx as Record<string, unknown>)['proprietarioId'];
    return typeof v === 'string' && v ? v : null;
  }

  /**
   * Escreve no estado da execução SEM RESSUSCITAR quem já foi cancelada.
   *
   * O `update` incondicional era o buraco: o PAUSAR_IA marcava CANCELADO, o
   * turno voltava do modelo 8s depois e gravava `status: 'EM_EXECUCAO'` por
   * cima. A partir dali a guarda do executor (`if status === 'CANCELADO'
   * return`) não pegava mais nada e o grafo seguia até o fim — criando a
   * segunda tarefa que o Léo via na agenda. É a mesma lição da rodada anterior
   * deste bug, um nível acima: cancelar não basta se algo depois escreve por
   * cima. Lá era o envio; aqui é o status.
   *
   * Devolve `false` quando nada foi escrito porque a execução está cancelada —
   * o chamador usa isso pra abortar a continuação ali mesmo.
   */
  private async atualizarSeViva(
    execucaoId: string,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    const { count } = await this.prisma.fluxoExecucao.updateMany({
      where: { id: execucaoId, status: { not: 'CANCELADO' } },
      data: data as never,
    });
    if (count === 0) {
      this.logger.warn(
        `CONVERSAR_IA: execução ${execucaoId} está CANCELADA — atualização de estado ignorada`,
      );
    }
    return count > 0;
  }

  /**
   * A execução ainda pode falar? `false` quando ela foi CANCELADA (ou sumiu).
   *
   * Erro de banco devolve `true` de propósito: numa falha de leitura, deixar o
   * bot mudo seria pior que o risco de uma fala a mais — a conversa em curso
   * simplesmente pararia, sem ninguém saber.
   */
  private async execucaoViva(execucaoId: string): Promise<boolean> {
    try {
      const ex = await this.prisma.fluxoExecucao.findUnique({
        where: { id: execucaoId },
        select: { status: true },
      });
      return ex ? ex.status !== 'CANCELADO' : false;
    } catch {
      return true;
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
    /**
     * Dono da instância que envia (WhatsApp pessoal do rep). Vem da conversa que
     * originou a execução — a resposta tem que sair pela MESMA porta por onde a
     * mensagem entrou, senão o cliente vê a conversa trocar de número no meio.
     * Null/undefined = número da empresa.
     */
    proprietarioId?: string | null,
    /**
     * Execução dona deste envio. Quando informada, o envio é abortado se a
     * execução tiver sido CANCELADA enquanto a IA pensava — ver `execucaoViva`.
     */
    execucaoId?: string,
  ): Promise<void> {
    if (!texto.trim()) return;
    // ÚLTIMA TRAVA antes de falar. A chamada ao modelo leva de 10 a 90s, e nesse
    // intervalo um PAUSAR_IA (rep assumiu, pós-venda, transferência) pode ter
    // cancelado esta execução. Sem esta checagem o bot falava DEPOIS da pausa —
    // exatamente o que o T1.11 flagrou em 26/08, 14s após o RT pausar. Aqui é o
    // ponto único por onde TODA fala do nó de IA passa: opener, turno e aviso.
    if (execucaoId && !(await this.execucaoViva(execucaoId))) {
      this.logger.warn(
        `CONVERSAR_IA: execução ${execucaoId} foi cancelada durante a chamada da IA — ` +
          `envio ABORTADO (bot pausado no meio do turno)`,
      );
      return;
    }
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
            const ctx = {
              ...(idemKey ? { idempotencyKey: `${idemKey}:b${i++}:${hash}` } : {}),
              ...(proprietarioId ? { proprietarioId } : {}),
            };
            return this.whatsapp.enviarTexto(empresaId, peerId, balao, ctx).then(async (r) => {
              // GRAVA a saída na conversa. O envio do fluxo ia direto pro
              // provider e só virava Message quando o ECO (fromMe) voltasse
              // pelo webhook — assíncrono e sem prazo. Quem lê a conversa
              // depois (o C2 montando histórico, o inbox, um relatório) podia
              // não achar nada: o bot não sabia o que ele mesmo tinha dito.
              //
              // Best-effort: a mensagem JÁ saiu; falhar o registro não pode
              // desfazer envio nem derrubar o passo.
              await this.inbox
                .processarMensagemEntrante({
                  empresaId,
                  canal: 'WHATSAPP',
                  peerId,
                  tipo: 'TEXT',
                  conteudo: balao,
                  direction: 'OUTBOUND',
                  enviadaPorBot: true,
                  externalId: r.externalId ?? undefined,
                  proprietarioId: proprietarioId ?? undefined,
                })
                .catch((err: unknown) =>
                  this.logger.warn(
                    `CONVERSAR_IA: falha ao registrar a saída na conversa: ` +
                      `${err instanceof Error ? err.message : String(err)}`,
                  ),
                );
            });
          };
        })(),
        // Presença sai pela MESMA porta dos balões (auditoria 20/08): sem o
        // dono, o "digitando…" ia pela instância da EMPRESA numa conversa que
        // é do WhatsApp pessoal do rep — a da empresa nem conhece esse peer.
        digitando: (ms) =>
          void this.whatsapp
            .enviarPresenca(empresaId, peerId, 'composing', ms, proprietarioId ?? undefined)
            .catch(() => undefined),
        pausado: () =>
          this.whatsapp
            .enviarPresenca(empresaId, peerId, 'paused', undefined, proprietarioId ?? undefined)
            .catch(() => undefined),
      },
    );
  }

  // ─── Teto de tokens por prompt (Fase C — spec §7) ────────────────────

  private dataRefs(): { dia: string; mes: string } {
    // #B14: era o relógio do SERVIDOR (container em UTC) — o teto diário zerava
    // às 21:00 de Brasília, dando 3h de cota extra todo fim de tarde e sem bater
    // com o relatório de custo, que já usava BRT.
    const dia = diaBrasilia();
    return { dia, mes: mesBrasilia() };
  }

  /**
   * O prompt escolhido no nó existe, é da empresa e está ATIVO? (#23)
   *
   * Quando não resolve (apagado, desativado ou de outro tenant), o
   * `compilarSystemPromptConversa` caía no prompt PADRÃO da biblioteca: o nó
   * seguia "funcionando" e o lead conversava com OUTRA persona, com outras
   * regras, que o dono do fluxo nunca escolheu. A auditoria só acrescentou um
   * warn no log — o comportamento errado continuou. Agora o nó trata como falha
   * e roteia pela saída de erro, que é onde o fluxo decide (tarefa/humano).
   */
  private async promptIndisponivel(empresaId: string, promptId?: string): Promise<boolean> {
    if (!promptId) return false;
    try {
      const row = await this.prisma.botPrompt.findFirst({
        where: { id: promptId, empresaId, ativo: true },
        select: { id: true },
      });
      return !row;
    } catch {
      return false; // fail-open: erro de infra não pode travar a conversa
    }
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

  /**
   * Acumula os tokens usados pelo prompt, com reset por dia/mês.
   *
   * AUDITORIA (#13): era LER o uso e ESCREVER a soma em dois passos. Duas
   * conversas respondendo ao mesmo tempo (o caso normal — o bot atende em
   * paralelo) liam o mesmo valor e a segunda gravava por cima da primeira:
   * update perdido. Na prática o teto de tokens do prompt era furado — o
   * contador andava mais devagar que o gasto real e o custo passava do limite
   * que o diretor configurou.
   *
   * Agora é um único UPDATE atômico; o CASE faz o reset de dia/mês dentro do
   * próprio statement, então não existe janela entre ler e somar.
   */
  private async registrarUsoPrompt(promptId: string | undefined, tokens: number): Promise<void> {
    if (!promptId || tokens <= 0) return;
    try {
      const { dia, mes } = this.dataRefs();
      await this.prisma.$executeRaw`
        UPDATE "BotPrompt"
        SET "usoTokensDia" = CASE WHEN "usoDiaRef" = ${dia} THEN "usoTokensDia" ELSE 0 END + ${tokens},
            "usoDiaRef" = ${dia},
            "usoTokensMes" = CASE WHEN "usoMesRef" = ${mes} THEN "usoTokensMes" ELSE 0 END + ${tokens},
            "usoMesRef" = ${mes}
        WHERE "id" = ${promptId}`;
    } catch {
      /* best-effort */
    }
  }

  private async montarHistorico(
    conversationId: string,
    limite = HISTORICO_DEFAULT,
    empresaId?: string,
  ): Promise<HistoricoMsg[]> {
    // Inclui TODOS os tipos (não só TEXT): áudio transcrito (tipo=AUDIO) carrega
    // a resposta do lead no conteudo. Filtrar só TEXT fazia a IA esquecer as
    // respostas em áudio e re-perguntar tudo na entrevista.
    // `limite` = quantas mensagens a empresa configurou (Persona Bot → histórico).
    const msgs = await this.prisma.message.findMany({
      // empresaId no filtro: defesa em profundidade. A conversa já vem do
      // contexto da execução (mesmo tenant), mas montar histórico é o ponto que
      // ALIMENTA O PROMPT DA IA — um id trocado aqui vazaria conversa alheia.
      where: { conversationId, ...(empresaId ? { conversation: { empresaId } } : {}) },
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
      // Sem sucessores, encerra — mas NÃO por cima de um CANCELADO. Foi assim
      // que a execução pausada terminou como CONCLUIDO no log do T1.11.
      await this.atualizarSeViva(execucaoId, { status: 'CONCLUIDO', terminouEm: new Date() });
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
  /**
   * Desistência DEPOIS do teto de reagendamento (executor): o WhatsApp ficou
   * indisponível tempo demais e a mensagem já não faz sentido. Aqui a execução
   * segue a saída "erro" — que é o que cria a tarefa e avisa alguém — em vez de
   * o job simplesmente morrer e o lead ficar parado sem ninguém saber.
   */
  async desistirPorIndisponibilidade(
    execucaoId: string,
    noId: string,
    ctx: ExecucaoContexto,
    err: unknown,
  ): Promise<void> {
    await this.rotearParaErro(execucaoId, noId, ctx, 'whatsapp_falha', err);
  }

  private async rotearParaErro(
    execucaoId: string,
    noId: string,
    ctx: ExecucaoContexto,
    tipo_erro: string,
    err: unknown,
  ): Promise<{ tipo_erro: string; mensagem_erro: string }> {
    const mensagem_erro = err instanceof Error ? err.message : String(err);
    this.logger.warn(`CONVERSAR_IA erro (${tipo_erro}) — exec ${execucaoId}: ${mensagem_erro}`);
    const viva = await this.atualizarSeViva(execucaoId, {
      status: 'EM_EXECUCAO',
      aguardandoNoId: null,
      timeoutEm: null,
      contexto: toJsonInput({ ...ctx, tipo_erro, mensagem_erro }),
    });
    // Execução cancelada não vira ramo de erro nem escala pra humano: quem
    // pausou já assumiu a conversa.
    if (!viva) return { tipo_erro, mensagem_erro };
    // A conversa PRECISA DE HUMANO — independente de existir aresta "erro".
    //
    // Sem isto o nó morria calado: em 24/08 a trava de saída bloqueou uma
    // resposta ruim (certíssimo), a saída "erro" do nó não tinha nada ligado, e
    // um lead industrial que acabou de relatar um problema ficou no silêncio sem
    // ninguém na empresa saber. Varredura da empresa: 6 dos 7 nós de IA em fluxo
    // ATIVO estavam com a saída "erro" solta — incluindo o T1, que é a porta de
    // entrada de TODO inbound.
    //
    // Ligar a aresta resolve caso a caso, mas é frágil por construção: são 6
    // fluxos pra editar, cada edição rebaixa o fluxo pra rascunho, e todo fluxo
    // NOVO precisa lembrar — esquecer é silencioso. Aqui cobre os 6 de uma vez.
    //
    // O campo já existia pra exatamente isto (`Conversation.precisaHumano`: "o
    // bot caiu no fallback, a conversa precisa de humano e sobe pro topo da
    // lista"); só o caminho de fluxo não usava.
    await this.marcarPrecisaHumano(ctx, tipo_erro, execucaoId);
    await this.enfileirarSucessores(execucaoId, noId, 'erro', false);
    return { tipo_erro, mensagem_erro };
  }

  /**
   * Sobe a conversa pro topo do inbox quando a IA falha. Best-effort: o objetivo
   * é NÃO deixar o lead no silêncio — falhar aqui não pode piorar o erro que já
   * estamos tratando.
   */
  private async marcarPrecisaHumano(
    ctx: ExecucaoContexto,
    tipo_erro: string,
    execucaoId: string,
  ): Promise<void> {
    try {
      const rec = ctx as Record<string, unknown>;
      let convId =
        typeof rec['conversationId'] === 'string' && rec['conversationId']
          ? (rec['conversationId'] as string)
          : null;
      if (!convId) {
        // Sem conversationId no contexto (C1/C2 por etapa, RB/RT por etiqueta):
        // acha pelo lead. `empresaId` vem da EXECUÇÃO — o contexto não carrega.
        const exec = await this.prisma.fluxoExecucao.findUnique({
          where: { id: execucaoId },
          select: { empresaId: true },
        });
        if (!exec?.empresaId) return;
        convId = await this.conversaDaEmpresaDoLead(
          exec.empresaId,
          typeof rec['leadId'] === 'string' ? (rec['leadId'] as string) : null,
        );
      }
      if (!convId) return;
      await this.prisma.conversation.update({
        where: { id: convId },
        data: { precisaHumano: true, status: 'PENDENTE' },
      });
      this.logger.warn(
        `CONVERSAR_IA: conversa ${convId} marcada PRECISA HUMANO (${tipo_erro}, exec ${execucaoId}) ` +
          `— o lead não pode ficar no silêncio`,
      );
    } catch (err) {
      this.logger.warn(
        `CONVERSAR_IA: falha ao marcar precisaHumano (exec ${execucaoId}): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
