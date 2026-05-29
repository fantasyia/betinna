import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
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
import { PropostasService } from './propostas.service';

@ApiTags('propostas')
@ApiBearerAuth()
@Controller('propostas')
export class PropostasController {
  constructor(private readonly propostas: PropostasService) {}

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
