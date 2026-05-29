import { Body, Controller, Get, Ip, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type ChangeStatusDto,
  type CreatePropostaDto,
  type ListPropostasDto,
  type UpdatePropostaDto,
  changeStatusSchema,
  createPropostaSchema,
  listPropostasSchema,
  updatePropostaSchema,
} from './propostas.dto';
import { PropostaAceiteService } from './proposta-aceite.service';
import { PropostasService } from './propostas.service';

const decidirAceiteSchema = z.object({
  decisao: z.enum(['ACEITA', 'RECUSADA']),
});

@ApiTags('propostas')
@ApiBearerAuth()
@Controller('propostas')
export class PropostasController {
  constructor(
    private readonly propostas: PropostasService,
    private readonly aceite: PropostaAceiteService,
  ) {}

  // ─── C3 — Aceite externo (PÚBLICO, sem login) ───────────────────────────
  // Declarados PRIMEIRO pra `aceite/:token` não colidir com `:id`.

  @Public()
  @Get('aceite/:token')
  @Throttle({ default: { limit: 30, ttl: seconds(60) } })
  @ApiOperation({ summary: 'Preview público da proposta via token de aceite (sem login).' })
  aceitePreview(@Param('token') token: string) {
    return this.aceite.resolverPreview(token);
  }

  @Public()
  @Post('aceite/:token/decidir')
  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  @ApiOperation({ summary: 'Cliente aceita/recusa a proposta. Aceite gera pedido automático.' })
  aceiteDecidir(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(decidirAceiteSchema)) dto: { decisao: 'ACEITA' | 'RECUSADA' },
    @Ip() ip: string,
  ) {
    return this.aceite.registrarDecisao(token, dto.decisao, ip);
  }

  @Get()
  @RequirePermissions({ module: 'propostas', action: 'view' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listPropostasSchema)) query: ListPropostasDto,
  ) {
    return this.propostas.list(user, query);
  }

  // ─── C2 — Exportação (declaradas antes de @Get(':id') por especificidade) ──

  @Get(':id/pdf')
  @RequirePermissions({ module: 'propostas', action: 'view' })
  @Audit({ action: 'exportar_pdf', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Gera PDF da proposta (retorna { filename, base64 }).' })
  exportarPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.exportarPdf(user, id);
  }

  @Get(':id/excel')
  @RequirePermissions({ module: 'propostas', action: 'view' })
  @Audit({ action: 'exportar_excel', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Gera Excel da proposta (retorna { filename, base64 }).' })
  exportarExcel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.exportarExcel(user, id);
  }

  @Post(':id/enviar-email')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @Audit({ action: 'enviar_email', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Envia a proposta (PDF anexo) por email pro cliente via Resend.' })
  enviarEmail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.enviarPorEmail(user, id);
  }

  @Post(':id/enviar-aceite')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @Audit({ action: 'enviar_aceite', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'C3 — Gera link público de aceite pra enviar ao cliente. Status vira AGUARDANDO_ASSINATURA.',
  })
  enviarAceite(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.enviarParaAceite(user, id);
  }

  @Get(':id')
  @RequirePermissions({ module: 'propostas', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.findById(user, id);
  }

  @Post()
  @RequirePermissions({ module: 'propostas', action: 'create' })
  @Audit({ action: 'create', resource: 'proposta', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPropostaSchema)) dto: CreatePropostaDto,
  ) {
    return this.propostas.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @Audit({ action: 'update', resource: 'proposta', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePropostaSchema)) dto: UpdatePropostaDto,
  ) {
    return this.propostas.update(user, id, dto);
  }

  @Put(':id/status')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @Audit({ action: 'change_status', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Muda status seguindo máquina de estados (RASCUNHO → ENVIADA → ... → ACEITA/RECUSADA)',
  })
  changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeStatusSchema)) dto: ChangeStatusDto,
  ) {
    return this.propostas.changeStatus(user, id, dto);
  }

  @Post(':id/converter-em-pedido')
  @RequirePermissions({ module: 'pedidos', action: 'create' })
  @Audit({ action: 'converter_pedido', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Cria Pedido com base na proposta ACEITA' })
  converter(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.converterEmPedido(user, id);
  }
}
