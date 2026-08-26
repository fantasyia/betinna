import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { MessageDirection } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { EnvService } from '@config/env.service';
import { InboxService } from '@modules/inbox/inbox.service';
import type { MensagemEntranteParams } from '@modules/inbox/inbox.types';
import { WhatsAppService } from '@integrations/whatsapp/whatsapp.service';
import { WhatsappPacingService } from '@shared/whatsapp-pacing/whatsapp-pacing.service';
import { MullerBotService } from './mullerbot.service';
import { MullerBotPersonaService } from './persona.service';
import type { HistoricoMsg } from './mullerbot-cache.service';
import { BotAuditoriaService } from './bot-auditoria.service';
import { BotCustoService } from './bot-custo.service';

/**
 * Fase 2 — Motor do bot no WhatsApp: número da EMPRESA e (opt-in) o PESSOAL
 * de cada rep.
 *
 * Registra-se como hook do InboxService (sem acoplamento circular) e, a cada
 * mensagem INBOUND nova, decide se responde automaticamente:
 *
 *   só WhatsApp → dono da conversa decide QUAL bot:
 *     · sem proprietarioId → bot da EMPRESA: liga/desliga global
 *       (empresa.botWhatsappAtivo), chave OpenAI da empresa, teto de custo.
 *     · com proprietarioId → bot PESSOAL do rep: só atua se a persona DELE
 *       existe e está ativa E ele tem chave OpenAI própria (o crédito é dele —
 *       por isso o teto de custo da EMPRESA não gateia nem conta este caminho).
 *   → conversa não pausada (handoff)? → não é spam?
 *   → monta histórico + prompt da persona DO DONO → chama OpenAI (15s)
 *   → sucesso: envia a resposta · falha/timeout: fallback + marca "precisa humano"
 */
// Sem emoji e sem promessa de prazo — o mesmo tom que os prompts exigem. Quem
// leva a conversa daqui é gente: o fallback marca `precisaHumano`, então a
// conversa sobe na inbox junto com o aviso.
const FALLBACK_MSG = 'Recebi sua mensagem. Estou verificando e já te retorno.';
const TIMEOUT_MS = 15_000;
const SPAM_LIMITE = 10; // msgs
const SPAM_JANELA_MS = 60_000; // por minuto
// Nome (case-insensitive) da tag que silencia o bot na rede de segurança (3.6).
const TAG_ENCERRADO = 'Encerrado';
const HISTORICO_MAX = 10;
/**
 * Idade máxima da mensagem pra o bot AUTO-RESPONDER. Acima disso é backlog /
 * history sync — quando o Baileys reconecta (ex: redeploy do Railway) ele
 * reentrega TODAS as mensagens recentes do servidor, inclusive as que chegaram
 * durante o downtime. A mensagem continua salva na inbox normalmente; o bot só
 * NÃO responde conversa que já passou (senão dispara uma rajada de respostas
 * idênticas a mensagens velhas). Mensagens ao vivo chegam em segundos.
 */
const IDADE_MAX_RESPOSTA_MS = 2 * 60_000; // 2 min
/**
 * Pausa curta após um fallback (IA falhou). Evita re-spammar o aviso a cada
 * mensagem, mas SEM matar a conversa por horas: se a falha foi transitória, o
 * bot volta a tentar depois disso. A conversa fica marcada `precisaHumano` pra
 * subir na inbox enquanto isso.
 */
const FALLBACK_PAUSA_MS = 10 * 60_000; // 10 min

/**
 * Quebra a resposta da IA em balões de WhatsApp. Divide em DOIS sinais:
 *  - "|||" (delimitador que a gente pede no prompt), e
 *  - LINHA EM BRANCO (parágrafo) — que o modelo já produz naturalmente, então
 *    a quebra funciona mesmo quando ele ignora o "|||" (modelos pequenos ignoram).
 * Respeita o teto: o excedente é juntado no último balão pra NÃO perder texto.
 * Uma frase única (sem "|||" nem parágrafo) → 1 balão só.
 */
/** Acima disso um balão único é "parede de texto" pro WhatsApp → quebra por frase. */
const LIMITE_BALAO = 200;

/**
 * Quebra um bloco longo em frases e reagrupa em até `max` balões de tamanho
 * parecido — fica natural no WhatsApp em vez de um parágrafo gigante. Usado como
 * REDE DE SEGURANÇA quando o modelo ignora o "|||" e devolve tudo num bloco só.
 */
function quebrarPorFrase(texto: string, max: number): string[] {
  // Frases mantendo a pontuação (. ! ? …); o resto sem pontuação vira a última.
  const frases = (texto.match(/[^.!?…]+[.!?…]+(?:\s|$)|[^.!?…]+$/g) ?? [texto])
    .map((f) => f.trim())
    .filter(Boolean);
  if (frases.length <= 1) return [texto.trim()]; // nada pra quebrar (1 frase só)
  const alvo = texto.length / Math.min(max, frases.length); // tamanho-alvo por balão
  const baloes: string[] = [];
  let atual = '';
  for (const f of frases) {
    const cand = atual ? `${atual} ${f}` : f;
    // Fecha o balão quando passou do alvo E ainda há orçamento pra mais balões.
    if (atual && cand.length > alvo && baloes.length < max - 1) {
      baloes.push(atual);
      atual = f;
    } else {
      atual = cand;
    }
  }
  if (atual) baloes.push(atual);
  return baloes;
}

export function dividirEmBaloes(texto: string, max: number): string[] {
  let partes = texto
    .split(/\s*\|\|\|\s*|\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length === 0) return [];
  // Rede de segurança: o modelo às vezes IGNORA o "|||" e devolve um bloco único
  // enorme (caso do nó "Conversar com IA", cuja resposta vem em JSON). Pra respeitar
  // a config "até N balões" sem depender da IA acertar, quebra esse bloco por frase.
  if (partes.length === 1 && partes[0].length > LIMITE_BALAO) {
    partes = quebrarPorFrase(partes[0], max);
  }
  if (partes.length <= max) return partes;
  // Estourou o teto: mantém os (max-1) primeiros e junta o resto no último.
  const cabeca = partes.slice(0, max - 1);
  cabeca.push(partes.slice(max - 1).join('\n\n'));
  return cabeca;
}

/** Pausa entre balões: curta e proporcional ao tamanho do próximo (≈ digitação). */
function pausaEntreBaloes(balao: string): number {
  return Math.min(4000, 600 + balao.length * 25);
}

/** Config da persona que rege como o bot ENVIA a resposta (balões, delay, "digitando"). */
export interface EnvioBotCfg {
  quebrarMensagens: boolean;
  maxMensagens: number;
  mostrarDigitando: boolean;
  delayRespostaSegundos: number;
}

/**
 * Envia uma resposta do bot respeitando a persona — FONTE ÚNICA pro bot geral E pro
 * nó "Conversar com IA" dos fluxos (antes cada um tinha sua cópia e divergiam: o
 * fluxo ignorava o `delayRespostaSegundos`, por exemplo). Quebra em balões (se
 * ligado), espera o delay no 1º balão (tempo de "pensar"), mostra "digitando…" e dá
 * uma pausa proporcional entre balões (preserva a ordem de entrega no WhatsApp).
 *
 * O ENVIO em si é injetado (`handlers.enviar`) porque cada trilha manda diferente:
 * o bot geral via `inbox.responderComoBot` (grava no inbox), o fluxo via
 * `whatsapp.enviarTexto` (eco do provider grava). Retorna os balões efetivamente
 * enviados (pra log/auditoria).
 */
export async function enviarEmBaloes(
  texto: string,
  cfg: EnvioBotCfg,
  handlers: {
    enviar: (balao: string) => Promise<void>;
    /** Mostra "digitando…" por `ms` (só chamado quando mostrarDigitando=true). */
    digitando?: (ms: number) => void;
    /** Marca "parou de digitar" (só chamado quando mostrarDigitando=true). */
    pausado?: () => Promise<void>;
    /**
     * Chamado ANTES de cada balão. Serve pra renovar o lock da conversa (#B15):
     * o envio pode levar minutos (delay de "pensar" + pausa proporcional entre N
     * balões) e o TTL fixo estourava no meio — uma 2ª mensagem do cliente pegava
     * o lock livre e o bot respondia em dobro, intercalado.
     */
    aoProgredir?: () => Promise<void>;
  },
): Promise<string[]> {
  const limpo = texto.trim();
  if (!limpo) return [];
  const baloes = cfg.quebrarMensagens
    ? dividirEmBaloes(limpo, cfg.maxMensagens)
    : [limpo.replace(/\s*\|\|\|\s*/g, ' ').trim()];
  const finais = baloes.filter(Boolean);
  if (finais.length === 0) finais.push(limpo);

  for (let i = 0; i < finais.length; i++) {
    const balao = finais[i];
    await handlers.aoProgredir?.();
    // 1º balão respeita o delay configurado (tempo de "pensar"); os próximos levam
    // uma pausa curta proporcional ao tamanho (≈ digitação) e preservam a ordem.
    const esperaMs =
      i === 0 ? Math.max(0, cfg.delayRespostaSegundos) * 1000 : pausaEntreBaloes(balao);
    if (cfg.mostrarDigitando) handlers.digitando?.(esperaMs);
    if (esperaMs > 0) await new Promise((r) => setTimeout(r, esperaMs));
    await handlers.enviar(balao);
    if (cfg.mostrarDigitando && handlers.pausado) await handlers.pausado();
  }
  return finais;
}

/**
 * Placeholders que o adapter do WhatsApp usa quando a mídia NÃO tem legenda.
 * Mensagem cujo conteúdo é só isso = não tem texto do cliente → escala humano.
 */
/**
 * TTL do lock de resposta por conversa. #B15: 120s era um chute que cobria o caso
 * comum, mas persona com delay alto + muitos balões passava disso e o lock caía
 * no meio do envio. O TTL segue existindo como rede de segurança (processo que
 * morre não deixa a conversa travada pra sempre), só que agora é RENOVADO a cada
 * balão — não precisa mais adivinhar a duração total.
 */
const LOCK_TTL_MS = 120_000;

const PLACEHOLDERS_MIDIA = new Set([
  '[imagem]',
  '[vídeo]',
  '[áudio]',
  '[documento]',
  '[sticker]',
  '[mensagem não suportada]',
]);

/**
 * Prepara a ENTRADA multimodal pra IA — FONTE ÚNICA pro bot geral E pro nó
 * "Conversar com IA": áudio (toggle `transcreverAudio`) vira texto via transcrição;
 * imagem (toggle `analisarImagem`) vira data-URL pra visão. Sem o toggle, devolve o
 * conteúdo cru (mídia sem texto escala pra humano nas regras de cada trilha). O
 * download/transcrição são injetados (mesmas services nas duas trilhas).
 */
export async function prepararEntradaMultimodal(
  params: Pick<
    MensagemEntranteParams,
    'tipo' | 'mediaUrl' | 'mediaMime' | 'conteudo' | 'empresaId'
  >,
  cfg: { transcreverAudio: boolean; analisarImagem: boolean },
  deps: {
    baixarMidia: (url: string) => Promise<Buffer | null>;
    transcreverAudio: (empresaId: string, bytes: Buffer, mime: string) => Promise<string>;
    /** Grava a transcrição na inbox ("🎤 ...") + loga (opcional). */
    aoTranscrever?: (texto: string) => Promise<void>;
    aoFalharTranscricao?: (erro: string) => void;
    /** #B13: download da imagem falhou — o bot vai responder SEM ter visto a foto. */
    aoFalharImagem?: (url: string) => void;
  },
): Promise<{ mensagemIA: string; imagemDataUrl?: string }> {
  let mensagemIA = params.conteudo;
  let imagemDataUrl: string | undefined;

  if (params.tipo === 'AUDIO' && cfg.transcreverAudio && params.mediaUrl) {
    const bytes = await deps.baixarMidia(params.mediaUrl).catch(() => null);
    const texto = bytes
      ? await deps
          .transcreverAudio(params.empresaId, bytes, params.mediaMime ?? 'audio/ogg')
          .catch((e) => {
            deps.aoFalharTranscricao?.(e instanceof Error ? e.message : String(e));
            return '';
          })
      : '';
    if (texto.trim()) {
      mensagemIA = texto.trim();
      await deps.aoTranscrever?.(mensagemIA);
    }
  } else if (params.tipo === 'IMAGE' && cfg.analisarImagem && params.mediaUrl) {
    const bytes = await deps.baixarMidia(params.mediaUrl).catch(() => null);
    if (bytes) {
      imagemDataUrl = `data:${params.mediaMime ?? 'image/jpeg'};base64,${bytes.toString('base64')}`;
      // Legenda real (se houver) vira o texto; placeholder "[imagem]" → vazio.
      mensagemIA = PLACEHOLDERS_MIDIA.has(params.conteudo) ? '' : params.conteudo;
    } else {
      // AUDITORIA #B13: sem os bytes, o bot seguia adiante com o conteúdo
      // "[imagem]" e RESPONDIA SOBRE A FOTO sem tê-la visto — alucinação
      // garantida, e mudo: nenhum log dizia que o download tinha falhado. Agora
      // sinaliza (o caller loga) e diz explicitamente ao modelo que não viu.
      deps.aoFalharImagem?.(params.mediaUrl);
      mensagemIA = PLACEHOLDERS_MIDIA.has(params.conteudo)
        ? '[o cliente enviou uma imagem, mas não consegui abrir o arquivo]'
        : `${params.conteudo}
[obs: o cliente enviou uma imagem que não consegui abrir]`;
    }
  }
  return { mensagemIA, imagemDataUrl };
}

@Injectable()
export class MullerWhatsappService implements OnModuleInit {
  private readonly logger = new Logger(MullerWhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly muller: MullerBotService,
    private readonly env: EnvService,
    private readonly auditoria: BotAuditoriaService,
    private readonly custo: BotCustoService,
    private readonly persona: MullerBotPersonaService,
    private readonly whatsapp: WhatsAppService,
    private readonly redis: RedisService,
    private readonly pacing: WhatsappPacingService,
  ) {}

  onModuleInit(): void {
    this.inbox.registrarBotHook((params, resultado) => {
      void this.aoReceber(params, resultado);
    });
    this.logger.log('Bot Muller registrado no Inbox (auto-resposta no WhatsApp da empresa)');
  }

  private async aoReceber(
    params: MensagemEntranteParams,
    resultado: { conversationId: string; messageId: string; duplicada: boolean },
  ): Promise<void> {
    const convId = resultado.conversationId;
    let lockConv: string | null = null;
    let lockTokenAtual = '';
    try {
      // 1. Filtros duros
      if (params.canal !== 'WHATSAPP') return;
      // Dono da conversa: '' = número da empresa; id = WhatsApp pessoal do rep
      // (bot PESSOAL — só responde se o rep ativou o dele, ver passo 2).
      const dono = params.proprietarioId ?? '';
      if (params.direction === 'OUTBOUND') return; // anti-eco (mensagem do próprio número)
      if (resultado.duplicada) return;
      // Grupos (@g.us): o bot geral NUNCA atua em grupo de WhatsApp (auditoria 2026-06).
      if (params.peerId?.endsWith('@g.us')) return;

      // 1.2 Anti-backlog — não auto-responde mensagem VELHA. Fica ANTES do lock
      // (é cálculo puro sobre params.data) por dois motivos: não gasta lock com
      // histórico, e a contagem anti-spam logo abaixo não pode contar a
      // reentrega do Baileys pós-reconnect (pausaria conversas legítimas em
      // massa depois de todo deploy).
      const idadeMsg = params.data ? Date.now() - params.data.getTime() : 0;
      if (idadeMsg > IDADE_MAX_RESPOSTA_MS) {
        this.logger.log(
          `[bot] NÃO-RESPONDE conv=${convId} peer=${params.peerId} — msg antiga ` +
            `(${Math.round(idadeMsg / 1000)}s, backlog/history sync)`,
        );
        return;
      }

      // 1.3 Anti-spam ANTES do lock. O contador ficava DEPOIS: numa rajada, as
      // mensagens concorrentes morriam no lock e NUNCA eram contadas — só a que
      // era processada entrava na conta (~3-10/min, sempre abaixo do limite), e
      // o gate praticamente nunca disparava. O flood era respondido
      // indefinidamente, queimando o teto DIÁRIO de tokens da empresa.
      if ((await this.contarMensagemPeer(params.empresaId, params.peerId)) > SPAM_LIMITE) {
        const handoffMs = this.env.get('BOT_HANDOFF_HORAS') * 60 * 60 * 1000;
        await this.prisma.conversation
          .update({
            where: { id: convId },
            data: { precisaHumano: true, botPausadoAte: new Date(Date.now() + handoffMs) },
          })
          .catch(() => undefined);
        this.logger.warn(
          `[bot] anti-spam: peer=${params.peerId} excedeu ${SPAM_LIMITE}/min — pausado + precisa humano`,
        );
        return;
      }

      // Lock por conversa: 2 mensagens distintas do mesmo peer em rajada disparam
      // 2 aoReceber concorrentes (hook fire-and-forget). Sem isso ambos passam os gates
      // (status só muda no fim) e o bot responde em dobro. SETNX serializa; quem não
      // pega o lock descarta. Degrada gracioso se o Redis cair (segue sem lock).
      const lockKey = `bot:resp:${convId}`;
      // TTL 120s cobre pacing reativo + geração da IA + balões (30s era curto demais — o
      // lock expirava no meio e uma 2ª msg respondia em dobro). Valor ÚNICO por handler p/
      // o release com fencing (Lua compare-and-delete) não apagar o lock de OUTRO handler.
      const lockToken = randomUUID();
      const lockOk = await this.redis
        .setNxEx(lockKey, lockToken, LOCK_TTL_MS / 1000)
        .catch(() => true);
      if (!lockOk) {
        this.logger.log(`[bot] conv=${convId} já em processamento — descarta msg concorrente`);
        return;
      }
      lockConv = lockKey;
      lockTokenAtual = lockToken;

      // Resolve o lead do peer UMA vez (telefone indexado) — serve as duas regras do
      // gate abaixo: "fluxo conduzindo" e "lead encerrado". Antes eram duas buscas de
      // telefone por contains (seq scan) em pontos diferentes do gate.
      const leadDoPeer = await this.buscarLeadDoPeer(
        params.empresaId,
        params.peerId,
        params.peerTelefone,
      );

      // 1.5 Orquestração (Fase B) — se um fluxo "Conversar com IA" está conduzindo
      // esta conversa, o bot geral NÃO responde (evita resposta dupla — quem fala
      // é o motor do fluxo). Dois caminhos: por LEAD (fluxos que já têm lead) e
      // por CONVERSA (triagem — o lead ainda nem existe na 1ª mensagem).
      if (await this.fluxoAssumiu(params.empresaId, convId, leadDoPeer?.id)) {
        this.logger.debug(
          `[bot] conversa conduzida por fluxo de IA — bot geral silencia conv=${convId}`,
        );
        return;
      }

      // 2. Bot ligado nesta conversa? O override por conversa (Conversation.botLigado)
      //    tem precedência sobre o liga/desliga do DONO:
      //    · empresa → empresa.botWhatsappAtivo (como sempre);
      //    · bot pessoal → persona ATIVA do rep. Sem persona = nunca configurou
      //      = off. E sem a chave OpenAI DELE o bot cala (log, não fallback:
      //      fallback mandaria mensagem — exatamente o que não pode sem chave).
      const [globalLigado, conv] = await Promise.all([
        dono
          ? this.persona.botPessoalAtivo(params.empresaId, dono)
          : this.prisma.empresa
              .findUnique({
                where: { id: params.empresaId },
                select: { botWhatsappAtivo: true },
              })
              .then((e) => e?.botWhatsappAtivo ?? false),
        this.prisma.conversation.findUnique({
          where: { id: convId },
          select: { botPausadoAte: true, botLigado: true, precisaHumano: true },
        }),
      ]);
      const ligado = conv?.botLigado ?? globalLigado;
      if (!ligado) return;
      if (dono && !(await this.muller.temChaveOpenAI(dono))) {
        this.logger.warn(
          `[bot] bot pessoal de ${dono} ativo mas SEM chave OpenAI — não responde conv=${convId}`,
        );
        return;
      }

      // 3. Conversa pausada por handoff?
      if (conv?.botPausadoAte && conv.botPausadoAte.getTime() > Date.now()) return;

      // 3.5 Já escalou pra humano? O bot CALA e espera o operador. Sem isso, depois
      //     de escalar (ex: vídeo que não dá pra ler) o bot voltava a responder na
      //     próxima mensagem, atropelando o atendimento humano. A flag é zerada
      //     quando o operador responde (ou religa o bot), aí o bot volta sozinho.
      if (conv?.precisaHumano) {
        this.logger.log(`[bot] conv=${convId} precisa humano — bot aguarda o operador`);
        return;
      }

      // 3.6 Rede de segurança — lead em etapa "Perdido" OU com tag "Encerrado":
      //     o bot NÃO responde (conversa encerrada/sem sinergia, não reabrir sozinho).
      //     Mas marca precisaHumano: um lead perdido que VOLTA a falar é sinal de
      //     venda — sobe na inbox pra um humano ver, em vez de cair no vazio.
      if (leadDoPeer?.encerrado) {
        await this.prisma.conversation
          .update({ where: { id: convId }, data: { precisaHumano: true } })
          .catch(() => undefined);
        this.logger.log(
          `[bot] conv=${convId} lead Perdido/Encerrado — bot silencia (humano avisado)`,
        );
        return;
      }

      // (Anti-spam foi pra ANTES do lock — ver 1.3.)

      // 4.4 Teto de custo — ANTES do multimodal. A transcrição do áudio (Whisper)
      // é uma chamada PAGA à OpenAI: rodar antes do gate deixava o bot gastando
      // exatamente quando o orçamento já tinha estourado.
      // Bot PESSOAL não passa aqui: a chave é do rep, o gasto é no crédito dele —
      // gatear (ou consumir) o orçamento da empresa estaria contando dinheiro errado.
      const teto = dono
        ? { bloqueado: false as const }
        : await this.custo.verificarTeto(params.empresaId);
      if (teto.bloqueado) {
        await this.inbox.marcarPrecisaHumano(convId).catch(() => undefined);
        void this.auditoria.registrar({
          empresaId: params.empresaId,
          conversationId: convId,
          messageId: resultado.messageId,
          pergunta: params.conteudo,
          resposta: null,
          status: 'SEM_RESPOSTA',
        });
        this.logger.warn(
          `[bot] BLOQUEADO-CUSTO conv=${convId}: ${'motivo' in teto ? teto.motivo : ''}`,
        );
        return;
      }

      // 4.5 Config do bot DO DONO (precisa ANTES — decide se transcreve áudio / vê imagem).
      const cfgBot = await this.persona.obterConfigBot(params.empresaId, dono);

      // 4.6 Multimodal — o que o bot vai "ler" (FONTE ÚNICA com o nó "Conversar com
      //     IA"): áudio→transcrição, imagem→visão, conforme a config da Persona.
      //     Sem o toggle, mídia sem texto continua escalando pra humano (4.7).
      const { mensagemIA, imagemDataUrl } = await prepararEntradaMultimodal(params, cfgBot, {
        baixarMidia: (url) => this.whatsapp.baixarMidia(url),
        transcreverAudio: (emp, bytes, mime) => this.muller.transcreverAudio(emp, bytes, mime),
        aoTranscrever: async (texto) => {
          // Mostra a transcrição na inbox (operador lê sem dar play).
          await this.prisma.message
            .update({ where: { id: resultado.messageId }, data: { conteudo: `🎤 ${texto}` } })
            .catch(() => undefined);
          this.logger.log(`[bot] áudio transcrito conv=${convId}: "${texto.slice(0, 60)}"`);
        },
        aoFalharTranscricao: (m) =>
          this.logger.warn(`[bot] transcrição falhou conv=${convId}: ${m}`),
        aoFalharImagem: (url) =>
          this.logger.warn(
            `[bot] download da imagem falhou conv=${convId} (${url.slice(0, 80)}) — ` +
              'o modelo vai responder SEM ver a foto',
          ),
      });

      // 4.7 Sem imagem pra ver E sem texto real → escala pra humano (regra antiga).
      if (!imagemDataUrl) {
        const avaliacao = this.temTextoParaResponder('TEXT', mensagemIA);
        if (!avaliacao.ok) {
          await this.inbox.marcarPrecisaHumano(convId).catch(() => undefined);
          this.logger.log(
            `[bot] SEM-RESPOSTA conv=${convId} peer=${params.peerId} tipo=${params.tipo} ` +
              `motivo="${avaliacao.motivo}" → marcado precisa humano`,
          );
          return;
        }
      }

      // 5. Histórico (últimas N msgs de texto)
      const historico = await this.montarHistorico(
        convId,
        resultado.messageId,
        cfgBot.historicoMensagens,
      );

      // 6. Chama a IA com timeout
      const inicio = Date.now();
      let resposta: {
        texto: string;
        tokensIn?: number;
        tokensOut?: number;
        promptTokensAprox?: number;
        modelo?: string;
        usouCatalogo?: boolean;
        produtosIncluidos?: number;
      } | null = null;
      const iaPromise = this.muller.responderComoEmpresa(params.empresaId, mensagemIA, historico, {
        // Bot pessoal: persona, prompt e CHAVE do rep dono da conversa.
        ...(dono ? { proprietarioId: dono } : {}),
        // Puro conversa por padrão; vira RAG quando MULLERBOT_WHATSAPP_CATALOGO=true.
        incluirCatalogo: this.env.get('MULLERBOT_WHATSAPP_CATALOGO'),
        // Quebra em balões (mais humano): a IA separa com "|||"; split no envio.
        quebrarMensagens: cfgBot.quebrarMensagens,
        maxMensagens: cfgBot.maxMensagens,
        // Visão: quando o cliente manda foto (e o toggle está ligado).
        imagemDataUrl,
      });
      // CAÇADA-BUG #32: registra o uso de tokens na promise ORIGINAL da IA (uma vez, via .then).
      // Mesmo que o timeout vença o race abaixo (fallback), a chamada da OpenAI pode concluir DEPOIS e
      // faturar tokens — sem isto o teto de custo subcontava justamente sob latência alta (quando mais
      // gasta). Por isso o registro saiu do caminho de sucesso pra cá (senão contaria 2x).
      void iaPromise
        .then((r) => {
          // Bot pessoal fica FORA do contador da empresa (crédito do rep) — o
          // gasto dele aparece na auditoria (tokensIn/Out por resposta).
          if (!dono && ((r.tokensIn ?? 0) > 0 || (r.tokensOut ?? 0) > 0)) {
            void this.custo.registrarUso(params.empresaId, r.tokensIn ?? 0, r.tokensOut ?? 0);
          }
        })
        .catch(() => undefined);
      try {
        resposta = await this.comTimeout(iaPromise, TIMEOUT_MS);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[bot] IA falhou conv=${convId} peer=${params.peerId}: ${m}`);
      }
      const tempoMs = Date.now() - inicio;

      // 7. Fallback se a IA falhou/demorou/veio vazia
      if (!resposta || !resposta.texto.trim()) {
        // RE-CHECK igual ao do caminho de sucesso, e pelo mesmo motivo: a chamada
        // à IA leva até 15s e nesse meio-tempo um fluxo pode ter assumido. Aqui o
        // estrago era MAIOR que resposta dupla — o fallback também marca
        // `precisaHumano` e pausa o bot, então uma falha do respondedor GERAL
        // congelava o atendimento que o FLUXO estava conduzindo (26/08: balão
        // genérico no meio do C1 + 15min de pausa, sem tarefa pra ninguém).
        // Fluxo vivo = o geral não fala e não encosta no estado da conversa.
        if (await this.fluxoAssumiu(params.empresaId, convId, leadDoPeer?.id)) {
          void this.auditoria.registrar({
            empresaId: params.empresaId,
            conversationId: convId,
            messageId: resultado.messageId,
            pergunta: mensagemIA,
            resposta: null,
            tempoMs,
            status: 'SEM_RESPOSTA',
          });
          this.logger.log(
            `[bot] IA falhou mas o fluxo conduz a conversa — fallback SUPRIMIDO conv=${convId}`,
          );
          return;
        }

        // AUDITORIA (média): o fallback saía SEM passar pelo pacing. Numa falha
        // sistêmica da IA (chave inválida, OpenAI fora), TODA conversa ativa
        // dispara o fallback ao mesmo tempo — uma rajada de mensagens no mesmo
        // número, que é exatamente o padrão que a Meta bane. O pacing existe pra
        // isso e este era um dos poucos envios fora dele.
        await this.pacing.aguardarSlot(params.empresaId, true).catch(() => undefined);
        await this.inbox.responderComoBot(convId, FALLBACK_MSG).catch(() => undefined);
        // Marca precisa-humano E pausa o bot por uma janela CURTA: assim o
        // fallback NÃO se repete a cada nova mensagem, mas a conversa não fica
        // muda por horas se a falha foi transitória — o bot volta a tentar.
        await this.prisma.conversation
          .update({
            where: { id: convId },
            data: { precisaHumano: true, botPausadoAte: new Date(Date.now() + FALLBACK_PAUSA_MS) },
          })
          .catch(() => undefined);
        void this.auditoria.registrar({
          empresaId: params.empresaId,
          conversationId: convId,
          messageId: resultado.messageId,
          pergunta: mensagemIA,
          resposta: FALLBACK_MSG,
          tempoMs,
          status: 'FALLBACK',
        });
        this.logger.warn(
          `[bot] FALLBACK conv=${convId} peer=${params.peerId} msg="${params.conteudo.slice(0, 60)}" tempo=${tempoMs}ms status=falha`,
        );
        return;
      }

      // 8. Sucesso — envia respeitando a persona (balões + delay + "digitando…")
      //    pelo helper COMPARTILHADO com o nó "Conversar com IA" (enviarEmBaloes):
      //    fonte única, sem divergência entre bot geral e fluxo. O "digitando…" usa
      //    `void` (no Evolution a chamada bloqueia pelo delay; roda em paralelo ao sleep).
      const tel = params.peerTelefone ?? params.peerId;

      // RE-CHECK antes de enviar (fecha a corrida): o gate do passo 1.5 rodou ANTES
      // da chamada à IA, que leva ~15s. Nesse meio-tempo um fluxo de triagem pode
      // ter assumido a conversa (o inbound dispara bot e fluxo EM PARALELO, hooks
      // fire-and-forget). Sem este segundo olhar, os dois respondiam o mesmo "oi".
      // AUDITORIA (média): o re-check olhava SÓ por conversa. Um fluxo que começou
      // DURANTE a geração e tem apenas `leadId` no contexto (LEAD_CRIADO,
      // CRON_AGENDADO, mudança de etapa) passava batido — e os dois respondiam a
      // mesma pessoa. O gate inicial (passo 1.5) já checa os dois; o re-check
      // precisa do mesmo par pra fechar a corrida de verdade.
      if (await this.fluxoAssumiu(params.empresaId, convId, leadDoPeer?.id)) {
        this.logger.log(
          `[bot] fluxo assumiu a conversa durante a geração — bot geral descarta a resposta conv=${convId}`,
        );
        return;
      }

      // Pacing global (faixa REATIVA — cliente escreveu): espaça das demais respostas
      // da empresa (nunca todas ao mesmo tempo se muitos clientes escrevem juntos).
      await this.pacing.aguardarSlot(params.empresaId, true);
      let balaoIdx = 0;
      let baloesFinais: string[];
      try {
        baloesFinais = await enviarEmBaloes(resposta.texto, cfgBot, {
          // #B15: estende o lock a cada balão, SÓ se ainda formos o dono
          // (mesmo fencing do release). Sem isso, um envio longo perdia o lock
          // no meio e a resposta saía duplicada.
          aoProgredir: () => this.renovarLock(lockConv, lockTokenAtual),
          // idemKey estável por (mensagem inbound + posição + hash do conteúdo): reprocesso do
          // mesmo inbound após o TTL do lock não reenvia balões já enviados.
          enviar: (balao) => {
            const hash = createHash('sha1').update(balao).digest('hex').slice(0, 12);
            return this.inbox.responderComoBot(
              convId,
              balao,
              `bot:${resultado.messageId}:b${balaoIdx++}:${hash}`,
            );
          },
          digitando: (ms) =>
            void this.whatsapp
              .enviarPresenca(params.empresaId, tel, 'composing', ms, dono || undefined)
              .catch(() => undefined),
          pausado: () =>
            this.whatsapp
              .enviarPresenca(params.empresaId, tel, 'paused', undefined, dono || undefined)
              .catch(() => undefined),
        });
      } catch (errEnvio) {
        // A IA respondeu mas o ENVIO falhou (Evolution fora, JID inválido) —
        // antes isso caía no catch genérico e virava silêncio TOTAL: cliente sem
        // resposta (ou pela metade), conversa não subia na inbox, ninguém sabia.
        // Escala pra humano e pausa curto (evita loop de reenvio com o provider fora).
        const m = errEnvio instanceof Error ? errEnvio.message : String(errEnvio);
        this.logger.error(
          `[bot] FALHA DE ENVIO conv=${convId} (${balaoIdx} balão(ões) saíram): ${m}`,
        );
        await this.prisma.conversation
          .update({
            where: { id: convId },
            data: { precisaHumano: true, botPausadoAte: new Date(Date.now() + FALLBACK_PAUSA_MS) },
          })
          .catch(() => undefined);
        void this.auditoria.registrar({
          empresaId: params.empresaId,
          conversationId: convId,
          messageId: resultado.messageId,
          pergunta: params.conteudo,
          // A IA gerou, o envio é que falhou — guarda o texto pra o operador ver
          // o que o cliente DEVERIA ter recebido. SEM_RESPOSTA porque, do ponto
          // de vista do cliente, foi exatamente isso que aconteceu.
          resposta: `[falha de envio: ${m}]\n${resposta.texto}`,
          tokensIn: resposta.tokensIn,
          tokensOut: resposta.tokensOut,
          status: 'SEM_RESPOSTA',
        });
        return;
      }
      // Texto efetivamente enviado (pra auditoria/log refletir a realidade).
      const respostaEnviada = baloesFinais.join('\n');
      // Auditoria + contagem de tokens (Sprint 2.2) — best-effort.
      void this.auditoria.registrar({
        empresaId: params.empresaId,
        conversationId: convId,
        messageId: resultado.messageId,
        pergunta: params.conteudo,
        resposta: respostaEnviada,
        tokensIn: resposta.tokensIn,
        tokensOut: resposta.tokensOut,
        tempoMs,
        modelo: resposta.modelo,
        status: 'OK',
      });
      // #32: `custo.registrarUso` saiu daqui pro `.then` da iaPromise (registra mesmo quando o timeout
      // vence o race — senão tokens faturados pós-timeout não entravam no teto).
      this.logger.log(
        `[bot] OK conv=${convId} peer=${params.peerId} modelo=${resposta.modelo ?? '?'} ` +
          `catalogo=${resposta.usouCatalogo ? `on(${resposta.produtosIncluidos ?? 0}prod)` : 'off'} ` +
          `quebra=${cfgBot.quebrarMensagens ? 'on' : 'off'} baloes=${baloesFinais.length} ` +
          `msg="${params.conteudo.slice(0, 60)}" prompt_aprox=${resposta.promptTokensAprox ?? '?'}tok ` +
          `tokens_in=${resposta.tokensIn ?? '?'} tokens_out=${resposta.tokensOut ?? '?'} tempo=${tempoMs}ms`,
      );
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.error(`[bot] erro inesperado conv=${convId}: ${m}`);
    } finally {
      // Fencing: só apaga SE ainda formos o dono (token bate). Se o nosso lock já expirou
      // e outro handler pegou um novo, o del cego apagaria o lock dele → resposta dupla.
      if (lockConv) {
        await this.redis
          .eval(
            "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
            [lockConv],
            [lockTokenAtual],
          )
          .catch(() => undefined);
      }
    }
  }

  /**
   * Estende o TTL do lock da conversa, com fencing: só renova se o valor ainda
   * for o NOSSO token. Best-effort — sem Redis o fluxo segue (degrada gracioso,
   * igual à aquisição).
   */
  private async renovarLock(chave: string | null, token: string): Promise<void> {
    if (!chave || !token) return;
    await this.redis
      .eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end",
        [chave],
        [token, LOCK_TTL_MS],
      )
      .catch(() => undefined);
  }

  /**
   * Ajuste 1 — decide se a mensagem tem TEXTO real pro bot responder.
   *  - TEXT com conteúdo (inclui emoji isolado tipo "👍") → responde.
   *  - IMAGE/VIDEO COM legenda → responde usando o texto (mídia ignorada por ora).
   *  - Mídia sem legenda / áudio / documento / figurinha / localização / contato
   *    / não-suportada → não responde (escala pra humano).
   */
  private temTextoParaResponder(
    tipo: string | undefined,
    conteudo: string,
  ): { ok: boolean; motivo: string } {
    const t = tipo || 'TEXT';
    const texto = (conteudo ?? '').trim();

    if (t === 'TEXT') {
      if (!texto) return { ok: false, motivo: 'texto vazio' };
      if (PLACEHOLDERS_MIDIA.has(texto)) return { ok: false, motivo: 'tipo não suportado' };
      return { ok: true, motivo: '' };
    }

    // Mídia: só responde quando há legenda (IMAGE/VIDEO trazem caption no conteúdo).
    if ((t === 'IMAGE' || t === 'VIDEO') && texto && !PLACEHOLDERS_MIDIA.has(texto)) {
      return { ok: true, motivo: '' };
    }
    return { ok: false, motivo: `mídia sem texto (${t.toLowerCase()})` };
  }

  private async montarHistorico(
    conversationId: string,
    msgAtualId: string,
    limite = HISTORICO_MAX,
  ): Promise<HistoricoMsg[]> {
    // Inclui TODOS os tipos (não só TEXT): áudio TRANSCRITO tem tipo=AUDIO e o
    // texto no conteudo ("🎤 ..."). Filtrar só TEXT fazia o bot ESQUECER as
    // respostas em áudio do cliente e re-perguntar tudo. Mídia sem texto entra
    // como placeholder ("[imagem]") — contexto válido de "mandou uma foto aqui".
    const msgs = await this.prisma.message.findMany({
      where: { conversationId, id: { not: msgAtualId } },
      orderBy: { criadoEm: 'desc' },
      take: limite,
      select: { direction: true, conteudo: true, criadoEm: true },
    });
    return msgs.reverse().map((m) => ({
      role: m.direction === MessageDirection.INBOUND ? ('user' as const) : ('assistant' as const),
      content: m.conteudo,
      at: m.criadoEm.getTime(),
    }));
  }

  /**
   * Busca o lead do peer por sufixo de telefone (8 dígitos, D18) usando o índice
   * de expressão `Lead_empresaId_telefoneSufixo_idx` (igualdade, não mais `contains`
   * em seq scan) e JÁ avalia se ele está "encerrado": etapa "Perdido" (enum legado
   * OU tipo terminal do funil) ou tag "Encerrado".
   *
   * UMA busca de telefone indexada serve as DUAS regras do gate (fluxo conduzindo +
   * lead encerrado) — antes eram duas buscas por `contains`. FAIL-OPEN: erro aqui
   * não pode impedir o bot de responder conversas legítimas.
   */
  private async buscarLeadDoPeer(
    empresaId: string,
    peerId: string,
    peerTelefone?: string,
  ): Promise<{ id: string; encerrado: boolean } | null> {
    try {
      const sufixo = (peerTelefone ?? peerId).replace(/\D/g, '').slice(-8);
      if (sufixo.length < 8) return null;
      // Igualdade no sufixo normalizado → usa o índice de expressão (não seq scan).
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Lead"
        WHERE "empresaId" = ${empresaId}
          AND RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) = ${sufixo}
        ORDER BY "atualizadoEm" DESC
        LIMIT 1
      `;
      const id = rows[0]?.id;
      if (!id) return null;
      // Carrega só o necessário pra avaliar "encerrado" (busca por id, indexada).
      const lead = await this.prisma.lead.findUnique({
        where: { id },
        select: {
          id: true,
          etapa: true,
          funilEtapa: { select: { tipo: true } },
          tags: { select: { tag: { select: { nome: true } } } },
        },
      });
      if (!lead) return null;
      const encerrado =
        lead.etapa === 'PERDIDO' ||
        lead.funilEtapa?.tipo === 'PERDIDO' ||
        lead.tags.some((t) => t.tag.nome.toLowerCase() === TAG_ENCERRADO.toLowerCase());
      return { id: lead.id, encerrado };
    } catch (err) {
      this.logger.warn(
        `[bot] buscarLeadDoPeer falhou (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Anti-spam por (empresa, peer) no REDIS — janela fixa de 60s via INCR+EXPIRE
   * atômico (Lua). Antes era um Map em memória: zerava a cada deploy (e deploy =
   * Baileys reentrega histórico = rajada), não compartilhava entre api/worker e
   * crescia sem limpeza. Fail-open: se o Redis cair, NÃO bloqueia o bot (anti-spam
   * é proteção secundária, não pode derrubar o atendimento).
   */
  /**
   * Conta a mensagem na janela anti-spam do peer e devolve o total da janela.
   * Chamado ANTES do lock de conversa — senão as mensagens da rajada morrem no
   * lock sem serem contadas e o gate nunca dispara. Fail-open se o Redis cair.
   */
  private async contarMensagemPeer(empresaId: string, peerId: string): Promise<number> {
    const key = `bot:spam:${empresaId}:${peerId}`;
    const ttl = Math.ceil(SPAM_JANELA_MS / 1000);
    try {
      const n = (await this.redis.eval(
        "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n",
        [key],
        [ttl],
      )) as number;
      return Number(n);
    } catch (err) {
      this.logger.warn(
        `[bot] anti-spam Redis indisponível (${err instanceof Error ? err.message : String(err)}) — fail-open`,
      );
      return 0;
    }
  }

  private comTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }

  /**
   * Orquestração (Fase B) — true quando há um fluxo "Conversar com IA" pausado
   * (execução AGUARDANDO) esperando ESTE lead responder. Nesse caso o bot geral
   * cala (quem conduz é o motor do fluxo). O lead já vem resolvido por
   * `buscarLeadDoPeer` (não refaz a busca de telefone).
   */
  /**
   * Tem fluxo de IA conduzindo esta conversa? Checa os DOIS caminhos — por
   * CONVERSA (triagem: o lead ainda nem existe na 1ª mensagem) e por LEAD
   * (fluxos que já têm lead). Ponto único usado pelo gate de entrada, pelo
   * re-check antes de enviar e pela supressão do fallback.
   */
  private async fluxoAssumiu(empresaId: string, convId: string, leadId?: string): Promise<boolean> {
    if (await this.fluxoConduzindoConversa(empresaId, convId)) return true;
    return leadId ? this.fluxoConduzindoLead(empresaId, leadId) : false;
  }

  private async fluxoConduzindoLead(empresaId: string, leadId: string): Promise<boolean> {
    try {
      // Espelha o guard por CONVERSA: só AGUARDANDO deixava uma janela em que o
      // fluxo estava rodando (PENDENTE/EM_EXECUCAO, ex.: entre o CRIAR_LEAD e o
      // opener da IA) e o bot geral respondia por cima — o lead recebia duas
      // mensagens diferentes, do fluxo e do bot.
      const aguardando = await this.prisma.fluxoExecucao.findFirst({
        where: {
          empresaId,
          status: { in: ['PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO'] },
          contexto: { path: ['leadId'], equals: leadId },
        },
        select: { id: true },
      });
      return aguardando != null;
    } catch {
      // Fail-open: um erro no guard NÃO pode impedir o bot de responder.
      return false;
    }
  }

  /**
   * Mesmo guard, mas pela CONVERSA — cobre o caso que o `fluxoConduzindoLead`
   * não cobria: fluxo de TRIAGEM, em que o lead AINDA NÃO EXISTE na 1ª mensagem
   * (é o próprio fluxo que o cria). Sem isto, bot geral e nó "Conversar com IA"
   * respondiam os dois o mesmo "oi" (resposta dupla com ~1s de diferença).
   *
   * Considera execução VIVA (não só AGUARDANDO): entre o CRIAR_LEAD e o nó de
   * IA a execução está PENDENTE/EM_EXECUCAO — janela em que o bot geral ainda
   * estaria gerando a resposta dele.
   */
  private async fluxoConduzindoConversa(
    empresaId: string,
    conversationId: string,
  ): Promise<boolean> {
    try {
      const viva = await this.prisma.fluxoExecucao.findFirst({
        where: {
          empresaId,
          status: { in: ['PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO'] },
          contexto: { path: ['conversationId'], equals: conversationId },
        },
        select: { id: true },
      });
      return viva != null;
    } catch {
      return false; // fail-open (igual ao guard por lead)
    }
  }
}
