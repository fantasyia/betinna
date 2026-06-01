import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MessageDirection } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { InboxService } from '@modules/inbox/inbox.service';
import type { MensagemEntranteParams } from '@modules/inbox/inbox.types';
import { MullerBotService } from './mullerbot.service';
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
const HISTORICO_MAX = 10;

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
  /** Anti-spam em memória: chave `empresaId:peerId` → timestamps recentes. */
  private readonly spam = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly muller: MullerBotService,
    private readonly env: EnvService,
    private readonly auditoria: BotAuditoriaService,
    private readonly custo: BotCustoService,
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

      // 2. Liga/desliga global da empresa
      const empresa = await this.prisma.empresa.findUnique({
        where: { id: params.empresaId },
        select: { botWhatsappAtivo: true },
      });
      if (!empresa?.botWhatsappAtivo) return;

      // 3. Conversa pausada por handoff?
      const conv = await this.prisma.conversation.findUnique({
        where: { id: convId },
        select: { botPausadoAte: true },
      });
      if (conv?.botPausadoAte && conv.botPausadoAte.getTime() > Date.now()) return;

      // 4. Anti-spam — mesmo número floodando → pausa + manda pra humano
      if (this.ehSpam(params.empresaId, params.peerId)) {
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

      // 4.5 Ajuste 1 — bot só responde quando há TEXTO real do cliente.
      // Mídia sem legenda (imagem/vídeo/áudio/documento/figurinha), localização,
      // contato ou mensagem não suportada → NÃO responde, só escala pra humano.
      // (Transcrição de áudio e leitura de mídia ficam pra próxima fase.)
      const avaliacao = this.temTextoParaResponder(params.tipo, params.conteudo);
      if (!avaliacao.ok) {
        await this.inbox.marcarPrecisaHumano(convId).catch(() => undefined);
        this.logger.log(
          `[bot] SEM-RESPOSTA conv=${convId} peer=${params.peerId} tipo=${params.tipo} ` +
            `motivo="${avaliacao.motivo}" → marcado precisa humano`,
        );
        return;
      }

      // 4.6 Teto de custo (Sprint 2.2) — se estourou o limite de tokens, o bot
      // pausa e escala pra humano.
      const teto = await this.custo.verificarTeto(params.empresaId);
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
        this.logger.warn(`[bot] BLOQUEADO-CUSTO conv=${convId}: ${teto.motivo}`);
        return;
      }

      // 5. Histórico (últimas N msgs de texto, cronológico, excluindo a atual)
      const historico = await this.montarHistorico(convId, resultado.messageId);

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
          this.muller.responderComoEmpresa(params.empresaId, params.conteudo, historico, {
            // Puro conversa por padrão; vira RAG quando MULLERBOT_WHATSAPP_CATALOGO=true.
            incluirCatalogo: this.env.get('MULLERBOT_WHATSAPP_CATALOGO'),
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
        await this.inbox.marcarPrecisaHumano(convId).catch(() => undefined);
        void this.auditoria.registrar({
          empresaId: params.empresaId,
          conversationId: convId,
          messageId: resultado.messageId,
          pergunta: params.conteudo,
          resposta: FALLBACK_MSG,
          tempoMs,
          status: 'FALLBACK',
        });
        this.logger.warn(
          `[bot] FALLBACK conv=${convId} peer=${params.peerId} msg="${params.conteudo.slice(0, 60)}" tempo=${tempoMs}ms status=falha`,
        );
        return;
      }

      // 8. Sucesso — envia a resposta
      await this.inbox.responderComoBot(convId, resposta.texto.trim());
      // Auditoria + contagem de tokens (Sprint 2.2) — best-effort.
      void this.auditoria.registrar({
        empresaId: params.empresaId,
        conversationId: convId,
        messageId: resultado.messageId,
        pergunta: params.conteudo,
        resposta: resposta.texto.trim(),
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
  ): Promise<HistoricoMsg[]> {
    const msgs = await this.prisma.message.findMany({
      where: { conversationId, id: { not: msgAtualId }, tipo: 'TEXT' },
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

  private ehSpam(empresaId: string, peerId: string): boolean {
    const key = `${empresaId}:${peerId}`;
    const agora = Date.now();
    const arr = (this.spam.get(key) ?? []).filter((t) => agora - t < SPAM_JANELA_MS);
    arr.push(agora);
    this.spam.set(key, arr);
    return arr.length > SPAM_LIMITE;
  }

  private comTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }
}
