import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@shared/decorators/public.decorator';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { ResendWebhookService } from './resend-webhook.service';

/**
 * Webhook do Resend — entrega, abertura, clique, bounce.
 *
 * Sempre **200 depois de verificado**, mesmo quando o evento não casa com
 * destinatário nenhum: e-mail transacional (convite, comissão) também dispara
 * evento, e devolver erro faria o Resend reenviar pra sempre um evento que a
 * gente conscientemente ignora.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(private readonly svc: ResendWebhookService) {}

  @Public()
  @Post('resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Eventos de e-mail do Resend (Svix). Exige RESEND_WEBHOOK_SECRET — sem ele, tudo é recusado.',
  })
  async receber(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
    @Body() body: { type?: string; data?: { email_id?: string; to?: string[] } },
  ): Promise<{ ok: true; efeito: string }> {
    // Verificação com o corpo CRU: o Svix assina os bytes originais, e o JSON já
    // re-serializado difere por um espaço que seja.
    const valido = this.svc.verificarAssinatura(req.rawBody, {
      id: svixId,
      timestamp: svixTimestamp,
      signature: svixSignature,
    });
    if (!valido) {
      // Sem secret configurado cai aqui também — e é o certo: aceitar sem
      // verificar deixaria qualquer um inflar o engajamento de uma campanha, e
      // engajamento inflado decide qual e-mail a pessoa recebe depois.
      throw new UnauthorizedException('Assinatura do webhook inválida');
    }

    const efeito = await this.svc.aplicar(body);
    if (efeito === 'aplicado') {
      this.logger.log(`[resend] ${body.type} → destinatário atualizado`);
    }
    return { ok: true, efeito };
  }
}
