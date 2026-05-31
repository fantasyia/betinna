import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MessageDirection } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { EnvService } from '@config/env.service';
import { InboxService } from '@modules/inbox/inbox.service';
import type { MensagemEntranteParams } from '@modules/inbox/inbox.types';
import { MullerBotService } from './mullerbot.service';
import type { HistoricoMsg } from './mullerbot-cache.service';

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

      // 5. Histórico (últimas N msgs de texto, cronológico, excluindo a atual)
      const historico = await this.montarHistorico(convId, resultado.messageId);

      // 6. Chama a IA com timeout
      const inicio = Date.now();
      let resposta: { texto: string; tokensIn?: number; tokensOut?: number } | null = null;
      try {
        resposta = await this.comTimeout(
          this.muller.responderComoEmpresa(params.empresaId, params.conteudo, historico),
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
        this.logger.warn(
          `[bot] FALLBACK conv=${convId} peer=${params.peerId} msg="${params.conteudo.slice(0, 60)}" tempo=${tempoMs}ms status=falha`,
        );
        return;
      }

      // 8. Sucesso — envia a resposta
      await this.inbox.responderComoBot(convId, resposta.texto.trim());
      this.logger.log(
        `[bot] OK conv=${convId} peer=${params.peerId} msg="${params.conteudo.slice(0, 60)}" ` +
          `tokens_in=${resposta.tokensIn ?? '?'} tokens_out=${resposta.tokensOut ?? '?'} tempo=${tempoMs}ms`,
      );
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.error(`[bot] erro inesperado conv=${convId}: ${m}`);
    }
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
