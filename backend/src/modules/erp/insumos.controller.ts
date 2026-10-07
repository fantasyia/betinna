import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CompraInsumoDto,
  type InsumoDto,
  type MovimentoInsumoDto,
  compraInsumoSchema,
  insumoSchema,
  movimentoInsumoSchema,
} from './insumos.dto';
import { InsumosService } from './insumos.service';

/**
 * ERP próprio · matéria-prima (tecido e aviamento). Só ADMIN/DIRECTOR e só com
 * `config.erpInterno.ativo` (o service recusa com 422 fora disso).
 */
@ApiTags('erp')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('erp/insumos')
export class InsumosController {
  constructor(private readonly svc: InsumosService) {}

  @Get()
  @ApiOperation({ summary: 'Insumos com saldo, custo médio e alerta de reposição' })
  listar(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listar(user);
  }

  @Get('cores')
  @ApiOperation({ summary: 'Cores da empresa (a mesma lista da vitrine) pra dar cor ao insumo' })
  cores(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.coresDaEmpresa(user);
  }

  @Post()
  @ApiOperation({ summary: 'Cadastra insumo (tecido ou aviamento, unidade própria)' })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(insumoSchema)) dto: InsumoDto,
  ) {
    return this.svc.criar(user, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Edita insumo (unidade só muda sem movimento)' })
  atualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(insumoSchema)) dto: InsumoDto,
  ) {
    return this.svc.atualizar(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Exclui insumo SEM movimento (com histórico, desative)' })
  excluir(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.excluir(user, id);
  }

  @Post(':id/compras')
  @ApiOperation({ summary: 'Entrada de compra — recalcula o custo médio ponderado' })
  comprar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(compraInsumoSchema)) dto: CompraInsumoDto,
  ) {
    return this.svc.comprar(user, id, dto);
  }

  @Post(':id/movimentos')
  @ApiOperation({ summary: 'Perda, sobra que voltou ou ajuste — motivo obrigatório' })
  movimentar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(movimentoInsumoSchema)) dto: MovimentoInsumoDto,
  ) {
    return this.svc.movimentar(user, id, dto);
  }

  @Get(':id/movimentos')
  @ApiOperation({ summary: 'Histórico do insumo (mais recentes primeiro)' })
  movimentos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    // Só uma cor do insumo (opcional).
    @Query('cor') insumoCorId?: string,
  ) {
    return this.svc.movimentos(user, id, insumoCorId || undefined);
  }
}
