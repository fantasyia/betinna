import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { EnvService } from '@config/env.service';
import { Public } from '@shared/decorators/public.decorator';
import { WebhookSignatureUtil } from '@shared/http/webhook-signature.util';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ClickSignAssinaturaService } from './clicksign-assinatura.service';

/** Documento finalizado e pronto pra baixar — é o evento que fecha o contrato. */
const EVENTOS_FECHAMENTO = ['document_closed', 'auto_close', 'close'];
/** Recusa: o contrato não vai sair, e alguém precisa saber hoje. */
const EVENTOS_RECUSA = ['refusal', 'document_refused'];

/**
 * Retorno da assinatura eletrônica (ClickSign).
 *
 * **Webhook, não varredura.** A ClickSign **proíbe polling** em documentos
 * ("Não é permitido realizar polling em documentos" — sem autorização prévia do
 * suporte). Então o retorno da assinatura só chega por aqui, e por isso este
 * endpoint precisa ser confiável: sem ele, o contrato é assinado lá e o app
 * nunca fica sabendo.
 *
 * **HMAC de verdade, diferente do Tiny.** A cada disparo a ClickSign manda
 * `Content-Hmac: sha256=<hash do corpo cru + segredo>`. Comparação em tempo
 * constante; corpo CRU, porque re-serializar o JSON muda bytes e quebra o hash.
 *
 * **ACK primeiro, trabalho depois.** A documentação deles é explícita: responda
 * rápido, processe em background. Resposta fora do 2xx conta como falha — e
 * redirecionamento também, porque eles não seguem redirect.
 */
@ApiTags('webhooks')
@Controller('webhooks/clicksign')
export class ClickSignWebhookController {
  private readonly logger = new Logger(ClickSignWebhookController.name);

  constructor(
    private readonly env: EnvService,
    private readonly assinatura: ClickSignAssinaturaService,
  ) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: seconds(60) } })
  @ApiOperation({ summary: 'Recebe os eventos de assinatura do ClickSign (HMAC).' })
  async receber(
    @Req() req: RawBodyRequest<Request>,
    @Headers('content-hmac') hmac?: string,
    @Headers('event') eventoHeader?: string,
  ): Promise<{ ok: true }> {
    const segredo = this.env.get('CLICKSIGN_WEBHOOK_SECRET');
    // Sem segredo configurado o endpoint RECUSA tudo. Aceitar sem verificar
    // deixaria qualquer um marcar contrato como assinado.
    if (!segredo) {
      this.logger.error('CLICKSIGN_WEBHOOK_SECRET ausente — evento recusado');
      throw new UnauthorizedException('Webhook não configurado', ErrorCode.AUTH_INVALID_TOKEN);
    }
    const cru = req.rawBody;
    if (!cru || !WebhookSignatureUtil.verifyHmacSha256(cru, hmac ?? '', segredo)) {
      this.logger.warn('Webhook do ClickSign com HMAC inválido — ignorado');
      throw new UnauthorizedException('Assinatura inválida', ErrorCode.AUTH_INVALID_TOKEN);
    }

    // O header `Event` existe justamente pra filtrar sem fazer parse do corpo —
    // é a recomendação deles. O corpo só é lido pro que interessa.
    const evento = (eventoHeader ?? '').toLowerCase() || this.nomeDoCorpo(cru);
    if (EVENTOS_FECHAMENTO.includes(evento)) {
      // Sem await: a resposta sai agora, o trabalho continua.
      void this.assinatura.registrarAssinado(cru).catch((err: unknown) => {
        this.logger.error(
          `Falha processando assinatura: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    } else if (EVENTOS_RECUSA.includes(evento)) {
      void this.assinatura.registrarRecusa(cru).catch(() => undefined);
    } else {
      this.logger.debug(`Evento ${evento || '(sem nome)'} recebido e ignorado`);
    }
    return { ok: true };
  }

  private nomeDoCorpo(cru: Buffer): string {
    try {
      const j = JSON.parse(cru.toString('utf8')) as { event?: { name?: string } };
      return (j.event?.name ?? '').toLowerCase();
    } catch {
      return '';
    }
  }
}
