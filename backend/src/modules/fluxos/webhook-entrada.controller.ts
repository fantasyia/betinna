import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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

  // ─── Receiver público (sistemas externos POSTam aqui com o token) ────
  @Public()
  @Post('webhooks/fluxo/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recebe um POST externo e dispara o gatilho WEBHOOK_RECEBIDO' })
  receber(@Param('token') token: string, @Body() payload: Record<string, unknown>) {
    return this.svc.processar(token, payload);
  }

  // ─── CRUD (DIRECTOR) ────────────────────────────────────────────────
  @ApiBearerAuth()
  @Post('orquestracao/webhooks')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Cria um webhook de entrada (gera token + URL pública)' })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(criarWebhookSchema)) dto: { nome: string },
  ) {
    return this.svc.criar(user, dto.nome);
  }

  @ApiBearerAuth()
  @Get('orquestracao/webhooks')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({ summary: 'Lista os webhooks de entrada da empresa' })
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
