import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type BaixaDto,
  type BaixaEmMassaDto,
  type CategoriaDto,
  type ContaDto,
  type EditarTituloDto,
  type ListarTitulosDto,
  type RecorrenciaDto,
  type TituloDto,
  baixaEmMassaSchema,
  baixaSchema,
  categoriaSchema,
  contaSchema,
  editarTituloSchema,
  listarTitulosSchema,
  recorrenciaSchema,
  tituloSchema,
} from './financeiro.dto';
import { FinanceiroService } from './financeiro.service';

/**
 * ERP próprio · financeiro (contas a pagar e a receber, sem NF-e). Só
 * ADMIN/DIRECTOR e só com `config.financeiro.ativo` (o service recusa com 422).
 */
@ApiTags('financeiro')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('financeiro')
export class FinanceiroController {
  constructor(private readonly svc: FinanceiroService) {}

  @Get('status')
  @ApiOperation({ summary: 'O financeiro está ligado nesta empresa?' })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.status(user);
  }

  @Get('titulos')
  @ApiOperation({ summary: 'A receber / a pagar com filtros e os totais do topo' })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listarTitulosSchema)) q: ListarTitulosDto,
  ) {
    return this.svc.listar(user, q);
  }

  @Post('titulos')
  @ApiOperation({ summary: 'Lançamento manual (pode parcelar em N meses)' })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(tituloSchema)) dto: TituloDto,
  ) {
    return this.svc.criar(user, dto);
  }

  @Put('titulos/:id')
  @ApiOperation({ summary: 'Edita lançamento aberto (valor só sem baixa)' })
  editar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(editarTituloSchema)) dto: EditarTituloDto,
  ) {
    return this.svc.editar(user, id, dto);
  }

  @Post('titulos/:id/cancelar')
  @ApiOperation({ summary: 'Cancela lançamento sem baixa' })
  cancelar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.cancelar(user, id);
  }

  @Post('titulos/:id/baixas')
  @ApiOperation({ summary: 'Baixa total ou parcial (data, valor, conta, forma)' })
  baixar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(baixaSchema)) dto: BaixaDto,
  ) {
    return this.svc.baixar(user, id, dto);
  }

  @Get('titulos/:id/baixas')
  @ApiOperation({ summary: 'Histórico de baixas do lançamento' })
  baixas(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.baixasDoTitulo(user, id);
  }

  @Post('baixas-em-massa')
  @ApiOperation({ summary: 'Quita vários lançamentos pelo saldo, na mesma conta e data' })
  emMassa(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(baixaEmMassaSchema)) dto: BaixaEmMassaDto,
  ) {
    return this.svc.baixarEmMassa(user, dto);
  }

  @Post('baixas/:id/estornar')
  @ApiOperation({ summary: 'Desfaz uma baixa (fica no histórico como estornada)' })
  estornar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.estornarBaixa(user, id);
  }

  @Get('categorias')
  @ApiOperation({ summary: 'Categorias de receita e despesa' })
  categorias(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.categorias(user);
  }

  @Post('categorias')
  criarCategoria(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(categoriaSchema)) dto: CategoriaDto,
  ) {
    return this.svc.salvarCategoria(user, dto);
  }

  @Put('categorias/:id')
  editarCategoria(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(categoriaSchema)) dto: CategoriaDto,
  ) {
    return this.svc.salvarCategoria(user, dto, id);
  }

  @Get('contas')
  @ApiOperation({ summary: 'Contas (banco, Asaas…) com saldo atual' })
  contas(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.contas(user);
  }

  @Post('contas')
  criarConta(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(contaSchema)) dto: ContaDto,
  ) {
    return this.svc.salvarConta(user, dto);
  }

  @Put('contas/:id')
  editarConta(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(contaSchema)) dto: ContaDto,
  ) {
    return this.svc.salvarConta(user, dto, id);
  }

  @Get('recorrencias')
  @ApiOperation({ summary: 'Despesas/receitas que se repetem todo mês' })
  recorrencias(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.recorrencias(user);
  }

  @Post('recorrencias')
  criarRecorrencia(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(recorrenciaSchema)) dto: RecorrenciaDto,
  ) {
    return this.svc.salvarRecorrencia(user, dto);
  }

  @Put('recorrencias/:id')
  editarRecorrencia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(recorrenciaSchema)) dto: RecorrenciaDto,
  ) {
    return this.svc.salvarRecorrencia(user, dto, id);
  }
}
