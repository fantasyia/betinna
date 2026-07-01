import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '@shared/decorators/public.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { WebhookEntradaService } from './webhook-entrada.service';

const criarWebhookSchema = z.object({ nome: z.string().trim().min(1).max(80) });

@ApiTags('orquestracao')
@Controller()
export class WebhookEntradaController {
  constructor(private readonly svc: WebhookEntradaService) {}

  // ─── Receiver público (sistemas externos POSTam aqui) ────────────────
  // Auth = HMAC-SHA256(rawBody) no header x-betinna-webhook-signature contra o
  // secret POR-TENANT. O :token na URL é só ROTEADOR da empresa, não credencial.
  @Public()
  @Post('webhooks/fluxo/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recebe um POST externo (HMAC-assinado) e dispara WEBHOOK_RECEBIDO' })
  receber(
    @Param('token') token: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-betinna-webhook-signature') signature: string | undefined,
    @Headers('x-betinna-webhook-timestamp') timestamp: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.svc.processar({
      token,
      rawBody: req.rawBody,
      signature,
      idempotencyKey,
      timestamp,
    });
  }

  // ─── CRUD (DIRECTOR) ────────────────────────────────────────────────
  @ApiBearerAuth()
  @Post('orquestracao/webhooks')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Cria um webhook de entrada (gera token + secret HMAC, mostrado 1x)' })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(criarWebhookSchema)) dto: { nome: string },
  ) {
    return this.svc.criar(user, dto.nome);
  }

  @ApiBearerAuth()
  @Post('orquestracao/webhooks/:id/rotacionar-secret')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Gera um novo secret HMAC pro webhook (mostrado 1x)' })
  rotacionar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.rotacionarSecret(user, id);
  }

  @ApiBearerAuth()
  @Get('orquestracao/webhooks')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({ summary: 'Lista os webhooks de entrada da empresa (sem o secret)' })
  listar(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listar(user);
  }

  @ApiBearerAuth()
  @Delete('orquestracao/webhooks/:id')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove um webhook de entrada' })
  async remover(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.svc.remover(user, id);
  }
}
