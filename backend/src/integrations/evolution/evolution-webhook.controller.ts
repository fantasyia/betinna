import { Body, Controller, Param, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@shared/decorators/public.decorator';
import { EnvService } from '@config/env.service';
import { WebhookAntiReplayService } from '@shared/utils/webhook-anti-replay.service';
import { EvolutionService } from './evolution.service';
import { EvolutionInboundService } from './evolution-inbound.service';

interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  data?: unknown;
}

/**
 * Recebe os eventos do Evolution API (mensagens, conexão, QR). Endpoint @Public,
 * protegido por um token derivado da EVOLUTION_API_KEY na URL.
 *   {API_URL}/webhooks/evolution/{token}
 *
 * SEGURANÇA — limitação honesta do provider:
 *  - Diferente dos marketplaces (Shopee/Meta/etc), o Evolution NÃO assina o
 *    corpo do webhook (não há HMAC pra validar — nós configuramos o Evolution e
 *    ele não envia assinatura). O token de 128 bits na URL É o segredo compartilhado.
 *  - Comparação do token em TEMPO CONSTANTE (timingSafeEqual) — antes era `!==`.
 *  - ANTI-REPLAY nas mensagens: dedup por (instância + id da mensagem) via Redis,
 *    reusando o WebhookAntiReplayService dos marketplaces. Soma à idempotência
 *    que o InboxService já faz por externalId (defesa em profundidade).
 *  - Próximo passo recomendado (precisa re-parear): mover o segredo da URL pra um
 *    header do webhook (URLs vazam em log de proxy/Referer; headers não).
 */
@ApiExcludeController()
@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  constructor(
    private readonly env: EnvService,
    private readonly inbound: EvolutionInboundService,
    private readonly antiReplay: WebhookAntiReplayService,
  ) {}

  @Public()
  @Post(':token')
  async receber(
    @Param('token') token: string,
    @Body() body: EvolutionWebhookBody,
  ): Promise<{ ok: boolean }> {
    const esperado = EvolutionService.webhookToken(this.env.get('EVOLUTION_API_KEY') || '');
    if (!esperado || !this.tokensIguais(token, esperado)) {
      throw new UnauthorizedException('webhook token inválido');
    }

    // Anti-replay (só faz sentido pra mensagens — eventos de conexão/QR podem
    // repetir sem efeito colateral). Sem timestamp: o Evolution não manda um
    // confiável, então usamos só o dedup por id (evita rejeitar msg legítima
    // levemente atrasada — o poll de fallback não passa por aqui).
    const chaveReplay = this.chaveReplay(body);
    if (chaveReplay) {
      const { fresh } = await this.antiReplay.checkAndMarkWebhook(
        'evolution',
        chaveReplay,
        undefined,
      );
      if (!fresh) return { ok: true }; // replay → ACK sem reprocessar
    }

    // Responde 200 na hora (pro Evolution não re-tentar) e processa em background.
    void this.inbound.processarEvento(body);
    return { ok: true };
  }

  /** Comparação em tempo constante (evita timing attack no token). */
  private tokensIguais(recebido: string, esperado: string): boolean {
    const a = Buffer.from(recebido);
    const b = Buffer.from(esperado);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Chave de dedup pra anti-replay — só pra mensagens entrantes (as que viram
   * Message + disparam o bot). `${instance}:${key.id}`. Null pra eventos sem id
   * (connection.update, qrcode.updated) que podem repetir sem problema.
   */
  private chaveReplay(body: EvolutionWebhookBody): string | null {
    if ((body.event ?? '').toLowerCase() !== 'messages.upsert') return null;
    const data = body.data as {
      messages?: Array<{ key?: { id?: string } }>;
      key?: { id?: string };
    };
    const msg = Array.isArray(data?.messages) ? data.messages[0] : data;
    const id = msg?.key?.id;
    return id ? `${body.instance ?? '?'}:${id}` : null;
  }
}
