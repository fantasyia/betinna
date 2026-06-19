import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MessageDirection } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { EnvService } from '@config/env.service';
import { InboxService } from '@modules/inbox/inbox.service';
import type { MensagemEntranteParams } from '@modules/inbox/inbox.types';
import { WhatsAppService } from '@integrations/whatsapp/whatsapp.service';
import { MullerBotService } from './mullerbot.service';
import { MullerBotPersonaService } from './persona.service';
import type { HistoricoMsg } from './mullerbot-cache.service';
import { BotAuditoriaService } from './bot-auditoria.service';
import { BotCustoService } from './bot-custo.service';

/**
 * Fase 2 — Motor do bot Muller no WhatsApp da EMPRESA.
 *
 * Registra-se como hook do InboxService (sem acoplamento circular) e, a cada
 * mensagem INBOUND nova, decide se responde automaticamente:
 *
 *   só WhatsApp + número da empresa (NUNCA o pessoal do rep)
 *   → bot global ligado? → conversa não pausada (handoff)? → não é spam?
 *   → monta histórico (últimas 10 msgs) + prompt da persona → chama OpenAI (15s)
 *   → sucesso: envia a resposta · falha/timeout: fallback + marca "precisa humano"
 */
const FALLBACK_MSG = 'Recebi sua mensagem! Vou conferir e já te respondo. 👍';
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

/**
 * Placeholders que o adapter do WhatsApp usa quando a mídia NÃO tem legenda.
 * Mensagem cujo conteúdo é só isso = não tem texto do cliente → escala humano.
 */
const PLACEHOLDERS_MIDIA = new Set([
  '[imagem]',
  '[vídeo]',
  '[áudio]',
  '[documento]',
  '[sticker]',
  '[mensagem não suportada]',
]);

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
    try {
      // 1. Filtros duros
      if (params.canal !== 'WHATSAPP') return;
      if (params.proprietarioId) return; // WhatsApp pessoal do rep — bot NUNCA atua
      if (params.direction === 'OUTBOUND') return; // anti-eco (mensagem do próprio número)
      if (resultado.duplicada) return;

      // 1.4 Anti-backlog — não auto-responde mensagem VELHA. Após reconnect, o
      // Baileys reentrega o histórico (append / messaging-history.set) e cada
      // mensagem do downtime chegaria aqui como nova. A msg já foi salva na
      // inbox; aqui só evitamos a rajada de respostas a conversas que já passaram.
      const idadeMs = params.data ? Date.now() - params.data.getTime() : 0;
      if (idadeMs > IDADE_MAX_RESPOSTA_MS) {
        this.logger.log(
          `[bot] NÃO-RESPONDE conv=${convId} peer=${params.peerId} — msg antiga ` +
            `(${Math.round(idadeMs / 1000)}s, backlog/history sync)`,
        );
        return;
      }

      // Resolve o lead do peer UMA vez (telefone indexado) — serve as duas regras do
      // gate abaixo: "fluxo conduzindo" e "lead encerrado". Antes eram duas buscas de
      // telefone por contains (seq scan) em pontos diferentes do gate.
      const leadDoPeer = await this.buscarLeadDoPeer(
        params.empresaId,
        params.peerId,
        params.peerTelefone,
      );

      // 1.5 Orquestração (Fase B) — se um fluxo "Conversar com IA" está conduzindo
      // esta conversa (lead com execução AGUARDANDO), o bot geral NÃO responde
      // (evita resposta dupla — quem fala é o motor do fluxo).
      if (leadDoPeer && (await this.fluxoConduzindoLead(params.empresaId, leadDoPeer.id))) {
        this.logger.debug(
          `[bot] conversa conduzida por fluxo de IA — bot geral silencia conv=${convId}`,
        );
        return;
      }

      // 2. Bot ligado nesta conversa? O override por conversa (Conversation.botLigado)
      //    tem precedência sobre o liga/desliga global da empresa:
      //    null = segue o global · true = ligado aqui mesmo com global off ·
      //    false = desligado aqui mesmo com global on.
      const [empresa, conv] = await Promise.all([
        this.prisma.empresa.findUnique({
          where: { id: params.empresaId },
          select: { botWhatsappAtivo: true },
        }),
        this.prisma.conversation.findUnique({
          where: { id: convId },
          select: { botPausadoAte: true, botLigado: true, precisaHumano: true },
        }),
      ]);
      const ligado = conv?.botLigado ?? empresa?.botWhatsappAtivo ?? false;
      if (!ligado) return;

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

      // 4. Anti-spam — mesmo número floodando → pausa + manda pra humano
      if (await this.ehSpam(params.empresaId, params.peerId)) {
        const handoffMs = this.env.get('BOT_HANDOFF_HORAS') * 60 * 60 * 1000;
        await this.prisma.conversation.update({
          where: { id: convId },
          data: { precisaHumano: true, botPausadoAte: new Date(Date.now() + handoffMs) },
        });
        this.logger.warn(
          `[bot] anti-spam: peer=${params.peerId} excedeu ${SPAM_LIMITE}/min — pausado + precisa humano`,
        );
        return;
      }

      // 4.5 Config do bot (precisa ANTES — decide se transcreve áudio / vê imagem).
      const cfgBot = await this.persona.obterConfigBot(params.empresaId);

      // 4.6 Multimodal — o que o bot vai "ler":
      //  - áudio + toggle ligado → transcreve (voz→texto) e mostra na inbox;
      //  - imagem + toggle ligado → manda a foto pra VISÃO da IA.
      // Sem o toggle ligado, mídia continua escalando pra humano (regra antiga).
      let mensagemIA = params.conteudo;
      let imagemDataUrl: string | undefined;

      if (params.tipo === 'AUDIO' && cfgBot.transcreverAudio && params.mediaUrl) {
        const bytes = await this.whatsapp.baixarMidia(params.mediaUrl).catch(() => null);
        const texto = bytes
          ? await this.muller
              .transcreverAudio(params.empresaId, bytes, params.mediaMime ?? 'audio/ogg')
              .catch((e) => {
                this.logger.warn(
                  `[bot] transcrição falhou conv=${convId}: ${e instanceof Error ? e.message : String(e)}`,
                );
                return '';
              })
          : '';
        if (texto.trim()) {
          mensagemIA = texto.trim();
          // Mostra a transcrição na inbox (operador lê sem dar play).
          await this.prisma.message
            .update({ where: { id: resultado.messageId }, data: { conteudo: `🎤 ${mensagemIA}` } })
            .catch(() => undefined);
          this.logger.log(`[bot] áudio transcrito conv=${convId}: "${mensagemIA.slice(0, 60)}"`);
        }
      } else if (params.tipo === 'IMAGE' && cfgBot.analisarImagem && params.mediaUrl) {
        const bytes = await this.whatsapp.baixarMidia(params.mediaUrl).catch(() => null);
        if (bytes) {
          imagemDataUrl = `data:${params.mediaMime ?? 'image/jpeg'};base64,${bytes.toString('base64')}`;
          // Legenda real (se houver) vira o texto; placeholder "[imagem]" → vazio.
          mensagemIA = PLACEHOLDERS_MIDIA.has(params.conteudo) ? '' : params.conteudo;
        }
      }

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

      // 4.8 Teto de custo (Sprint 2.2) — se estourou o limite de tokens, o bot
      // pausa e escala pra humano.
      const teto = await this.custo.verificarTeto(params.empresaId);
      if (teto.bloqueado) {
        await this.inbox.marcarPrecisaHumano(convId).catch(() => undefined);
        void this.auditoria.registrar({
          empresaId: params.empresaId,
          conversationId: convId,
          messageId: resultado.messageId,
          pergunta: mensagemIA,
          resposta: null,
          status: 'SEM_RESPOSTA',
        });
        this.logger.warn(`[bot] BLOQUEADO-CUSTO conv=${convId}: ${teto.motivo}`);
        return;
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
      try {
        resposta = await this.comTimeout(
          this.muller.responderComoEmpresa(params.empresaId, mensagemIA, historico, {
            // Puro conversa por padrão; vira RAG quando MULLERBOT_WHATSAPP_CATALOGO=true.
            incluirCatalogo: this.env.get('MULLERBOT_WHATSAPP_CATALOGO'),
            // Quebra em balões (mais humano): a IA separa com "|||"; split no envio.
            quebrarMensagens: cfgBot.quebrarMensagens,
            maxMensagens: cfgBot.maxMensagens,
            // Visão: quando o cliente manda foto (e o toggle está ligado).
            imagemDataUrl,
          }),
          TIMEOUT_MS,
        );
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[bot] IA falhou conv=${convId} peer=${params.peerId}: ${m}`);
      }
      const tempoMs = Date.now() - inicio;

      // 7. Fallback se a IA falhou/demorou/veio vazia
      if (!resposta || !resposta.texto.trim()) {
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

      // 8. Sucesso — envia. Se "quebrar em balões" estiver ligado, manda vários
      //    balões curtos (mais humano), com "digitando…" e pausa entre eles.
      const tel = params.peerTelefone ?? params.peerId;
      const textoLimpo = resposta.texto.trim();
      const baloes = cfgBot.quebrarMensagens
        ? dividirEmBaloes(textoLimpo, cfgBot.maxMensagens)
        : [textoLimpo.replace(/\s*\|\|\|\s*/g, ' ').trim()];
      // Salvaguarda: se o split zerar (texto só de delimitadores), manda o texto cru.
      const baloesFinais = baloes.filter(Boolean);
      if (baloesFinais.length === 0) baloesFinais.push(textoLimpo);

      for (let i = 0; i < baloesFinais.length; i++) {
        const balao = baloesFinais[i];
        // 1º balão respeita o delay configurado (tempo de "pensar"); os próximos
        // levam uma pausa curta proporcional ao tamanho (digitação) — e isso
        // também preserva a ORDEM de entrega no WhatsApp (envio rápido demais
        // pode chegar fora de ordem).
        const esperaMs = i === 0 ? cfgBot.delayRespostaSegundos * 1000 : pausaEntreBaloes(balao);
        if (cfgBot.mostrarDigitando) {
          // Passa esperaMs como `delay` pra o "digitando…" durar a espera. NÃO
          // aguarda (void): no Evolution essa chamada bloqueia pelo delay, então
          // ela roda em paralelo com o nosso sleep (não soma o tempo).
          void this.whatsapp
            .enviarPresenca(params.empresaId, tel, 'composing', esperaMs)
            .catch(() => undefined);
        }
        if (esperaMs > 0) await new Promise((r) => setTimeout(r, esperaMs));
        await this.inbox.responderComoBot(convId, balao);
        if (cfgBot.mostrarDigitando) {
          await this.whatsapp
            .enviarPresenca(params.empresaId, tel, 'paused')
            .catch(() => undefined);
        }
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
      void this.custo.registrarUso(
        params.empresaId,
        resposta.tokensIn ?? 0,
        resposta.tokensOut ?? 0,
      );
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
    }
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
  private async ehSpam(empresaId: string, peerId: string): Promise<boolean> {
    const key = `bot:spam:${empresaId}:${peerId}`;
    const ttl = Math.ceil(SPAM_JANELA_MS / 1000);
    try {
      const n = (await this.redis.eval(
        "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n",
        [key],
        [ttl],
      )) as number;
      return Number(n) > SPAM_LIMITE;
    } catch (err) {
      this.logger.warn(
        `[bot] anti-spam Redis indisponível (${err instanceof Error ? err.message : String(err)}) — fail-open`,
      );
      return false;
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
  private async fluxoConduzindoLead(empresaId: string, leadId: string): Promise<boolean> {
    try {
      const aguardando = await this.prisma.fluxoExecucao.findFirst({
        where: { empresaId, status: 'AGUARDANDO', contexto: { path: ['leadId'], equals: leadId } },
        select: { id: true },
      });
      return aguardando != null;
    } catch {
      // Fail-open: um erro no guard NÃO pode impedir o bot de responder.
      return false;
    }
  }
}
