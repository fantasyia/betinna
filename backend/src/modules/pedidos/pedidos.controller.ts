import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CancelarPedidoDto,
  type CreatePedidoDto,
  type DecidirCancelamentoDto,
  type ListPedidosDto,
  type ListSolicitacoesCancelamentoDto,
  type PreviewPedidoDto,
  type SolicitarCancelamentoDto,
  type UpdatePedidoDto,
  cancelarPedidoSchema,
  createPedidoSchema,
  decidirCancelamentoSchema,
  listPedidosSchema,
  listSolicitacoesCancelamentoSchema,
  previewPedidoSchema,
  solicitarCancelamentoSchema,
  updatePedidoSchema,
} from './pedidos.dto';
import { PedidosService } from './pedidos.service';

@ApiTags('pedidos')
@ApiBearerAuth()
@Controller('pedidos')
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  @Post('preview')
  @RequirePermissions({ module: 'pedidos', action: 'create' })
  @ApiOperation({
    summary: 'Calcula totais e checa se requer aprovação (sem persistir)',
  })
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(previewPedidoSchema)) dto: PreviewPedidoDto,
  ) {
    return this.pedidos.preview(user, dto);
  }

  @Get()
  @RequirePermissions({ module: 'pedidos', action: 'view' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listPedidosSchema)) query: ListPedidosDto,
  ) {
    return this.pedidos.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'pedidos', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pedidos.findById(user, id);
  }

  @Post()
  @RequirePermissions({ module: 'pedidos', action: 'create' })
  @Audit({ action: 'create', resource: 'pedido', resourceIdFrom: 'response.id' })
  @ApiOperation({
    summary: 'Cria pedido. Dispara aprovação automática se desconto > teto do rep.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPedidoSchema)) dto: CreatePedidoDto,
  ) {
    return this.pedidos.create(user, dto);
  }

  @Post(':id/duplicar')
  @RequirePermissions({ module: 'pedidos', action: 'create' })
  @Audit({ action: 'duplicate', resource: 'pedido', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Duplica pedido existente. Preços são recalculados. Vincula pedidoOrigemId.',
  })
  duplicar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pedidos.duplicar(user, id);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'pedidos', action: 'edit' })
  @Audit({ action: 'update', resource: 'pedido', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePedidoSchema)) dto: UpdatePedidoDto,
  ) {
    return this.pedidos.update(user, id, dto);
  }

  @Post(':id/avancar-status')
  @RequirePermissions({ module: 'pedidos', action: 'edit' })
  @Audit({ action: 'avancar_status', resource: 'pedido', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Avança status do pedido (ENVIADO_OMIE→PAGO→EM_SEPARACAO→ENVIADO→ENTREGUE). Dispara trigger PEDIDO_ENTREGUE.',
  })
  avancarStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pedidos.avancarStatus(user, id);
  }

  @Post(':id/cancelar')
  @Roles('ADMIN', 'DIRECTOR')
  @RequirePermissions({ module: 'pedidos', action: 'edit' })
  @Audit({ action: 'cancelar', resource: 'pedido', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Cancela pedido. Restrito a DIRECTOR/ADMIN (P6 — rep/gerente não pode cancelar).',
  })
  cancelar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelarPedidoSchema)) dto: CancelarPedidoDto,
  ) {
    return this.pedidos.cancelar(user, id, dto);
  }

  @Post(':id/enviar-omie')
  @RequirePermissions({ module: 'pedidos', action: 'edit' })
  @Audit({ action: 'enviar_omie', resource: 'pedido', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Envia pedido ao OMIE (mock até integração real). Bloqueia se cliente bloqueado.',
  })
  enviarOmie(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pedidos.enviarParaOmie(user, id);
  }

  // ─── P6.2 — Solicitação de cancelamento (rep/gerente → diretor) ────────

  @Post(':id/solicitar-cancelamento')
  @RequirePermissions({ module: 'pedidos', action: 'edit' })
  @Audit({
    action: 'solicitar_cancelamento',
    resource: 'pedido',
    resourceIdFrom: 'params.id',
  })
  @ApiOperation({
    summary:
      'REP/GERENTE solicita cancelamento de pedido com motivo. Diretor decide depois.',
  })
  solicitarCancelamento(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(solicitarCancelamentoSchema)) dto: SolicitarCancelamentoDto,
  ) {
    return this.pedidos.solicitarCancelamento(user, id, dto);
  }

  @Get('cancelamentos')
  @RequirePermissions({ module: 'pedidos', action: 'view' })
  @ApiOperation({
    summary:
      'Lista solicitações de cancelamento. DIRECTOR/ADMIN vê todas do tenant; REP/GERENTE vê só as suas.',
  })
  listSolicitacoesCancelamento(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listSolicitacoesCancelamentoSchema))
    query: ListSolicitacoesCancelamentoDto,
  ) {
    return this.pedidos.listSolicitacoesCancelamento(user, query);
  }

  @Post('cancelamentos/:id/decidir')
  @Roles('ADMIN', 'DIRECTOR')
  @RequirePermissions({ module: 'pedidos', action: 'edit' })
  @Audit({
    action: 'decidir_cancelamento',
    resource: 'pedido_cancelamento_solicitacao',
    resourceIdFrom: 'params.id',
  })
  @ApiOperation({
    summary:
      'DIRECTOR/ADMIN aprova ou rejeita uma solicitação de cancelamento. APROVADA → pedido vira CANCELADO.',
  })
  decidirCancelamento(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decidirCancelamentoSchema)) dto: DecidirCancelamentoDto,
  ) {
    return this.pedidos.decidirCancelamento(user, id, dto);
  }
}
