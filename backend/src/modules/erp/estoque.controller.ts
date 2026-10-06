import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type AjusteEstoqueDto,
  type InventarioDto,
  type MinimosDto,
  type MovimentosQueryDto,
  ajusteEstoqueSchema,
  inventarioSchema,
  minimosSchema,
  movimentosQuerySchema,
} from './estoque.dto';
import { EstoqueService } from './estoque.service';

/**
 * ERP próprio · estoque de peça pronta. Só ADMIN/DIRECTOR e só em empresa com
 * `config.erpInterno.ativo` (o service recusa com 422 fora disso).
 */
@ApiTags('erp')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('erp/estoque')
export class EstoqueController {
  constructor(private readonly svc: EstoqueService) {}

  @Get('status')
  @ApiOperation({ summary: 'O estoque (ERP próprio) está ligado nesta empresa?' })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.status(user);
  }

  @Get('saldos')
  @ApiOperation({ summary: 'Físico, reservado e disponível por variação' })
  saldos(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.saldos(user);
  }

  @Get('movimentos')
  @ApiOperation({ summary: 'Histórico de movimentos (mais recentes primeiro)' })
  movimentos(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(movimentosQuerySchema)) q: MovimentosQueryDto,
  ) {
    return this.svc.movimentos(user, q);
  }

  @Post('ajustes')
  @ApiOperation({ summary: 'Ajuste (inventário/correção) ou devolução — motivo obrigatório' })
  ajustar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ajusteEstoqueSchema)) dto: AjusteEstoqueDto,
  ) {
    return this.svc.ajustar(user, dto);
  }

  @Get('reposicao')
  @ApiOperation({ summary: 'Variações abaixo do estoque mínimo (maior falta primeiro)' })
  reposicao(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.reposicao(user);
  }

  @Put('minimos')
  @ApiOperation({ summary: 'Define o estoque mínimo por variação (null tira)' })
  minimos(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(minimosSchema)) dto: MinimosDto,
  ) {
    return this.svc.definirMinimos(user, dto);
  }

  @Post('inventario')
  @ApiOperation({ summary: 'Inventário: o contado vira ajuste da diferença, de uma vez' })
  inventario(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(inventarioSchema)) dto: InventarioDto,
  ) {
    return this.svc.inventario(user, dto);
  }

  @Get('pedidos/:id/reserva')
  @ApiOperation({ summary: 'Situação da reserva do pedido (relógio de 20 min)' })
  reserva(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.reservaDoPedido(user, id);
  }

  @Post('pedidos/:id/pagamento-recebido')
  @ApiOperation({ summary: 'Pix recebido: confirma a reserva e marca o pedido como PAGO' })
  pagamentoRecebido(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.pagamentoRecebido(user, id);
  }

  @Post('pedidos/:id/reativar')
  @ApiOperation({ summary: 'Pedido cancelado por reserva expirada volta com 20 min novos' })
  reativar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.reativar(user, id);
  }
}
