import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CorteDto,
  type CriarOpDto,
  type EnvioDto,
  type EtapaOpDto,
  type RecebimentoDto,
  type SimularOpDto,
  corteSchema,
  criarOpSchema,
  envioSchema,
  etapaOpSchema,
  recebimentoSchema,
  simularOpSchema,
} from './ordens.dto';
import { OrdensService } from './ordens.service';

/**
 * ERP próprio · ordem de produção. Só ADMIN/DIRECTOR e só com
 * `config.erpInterno.ativo` (o service recusa com 422 fora disso).
 */
@ApiTags('erp')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('erp/ops')
export class OrdensController {
  constructor(private readonly svc: OrdensService) {}

  @Get()
  @ApiOperation({ summary: 'OPs (mais recentes primeiro) com totais da grade' })
  listar(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listar(user);
  }

  @Post('simular')
  @ApiOperation({
    summary: 'Antes de gerar: tecido, aviamentos, falta no estoque e custo previsto',
  })
  simular(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(simularOpSchema)) dto: SimularOpDto,
  ) {
    return this.svc.simular(user, dto);
  }

  @Get('faccoes/situacao')
  @ApiOperation({ summary: 'O que está com cada facção: peças a receber, atrasos, aviamentos' })
  situacao(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.situacaoFaccoes(user);
  }

  @Post()
  @ApiOperation({ summary: 'Gera a OP (rascunho) com a grade' })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(criarOpSchema)) dto: CriarOpDto,
  ) {
    return this.svc.criar(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'OP com grade, consumos, entregas, custos e sugestões da ficha' })
  obter(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.obter(user, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Edita OP em rascunho' })
  editar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(criarOpSchema)) dto: CriarOpDto,
  ) {
    return this.svc.editar(user, id, dto);
  }

  @Post(':id/corte')
  @ApiOperation({ summary: 'Corte: tecido gasto (baixa) e peças cortadas' })
  cortar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(corteSchema)) dto: CorteDto,
  ) {
    return this.svc.cortar(user, id, dto);
  }

  @Post(':id/envio')
  @ApiOperation({ summary: 'Envio pra facção: peças, aviamentos (baixa) e preço por peça' })
  enviar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(envioSchema)) dto: EnvioDto,
  ) {
    return this.svc.enviar(user, id, dto);
  }

  @Post(':id/recebimentos')
  @ApiOperation({ summary: 'Entrega da facção (várias por OP): peça pronta entra no estoque' })
  receber(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(recebimentoSchema)) dto: RecebimentoDto,
  ) {
    return this.svc.receber(user, id, dto);
  }

  @Post(':id/fechar')
  @ApiOperation({ summary: 'Fecha a OP: custo real por peça por grade (vai pra calculadora)' })
  fechar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.fechar(user, id);
  }

  @Get(':id/divisao')
  @ApiOperation({ summary: 'Prévia da divisão da OP em 2 (metade A e B da grade)' })
  previaDivisao(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.previaDivisao(user, id);
  }

  @Post(':id/dividir')
  @ApiOperation({ summary: 'Divide a OP em 2: a atual fica com a metade A, nasce a B' })
  dividir(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.dividir(user, id);
  }

  @Patch(':id/etapa')
  @ApiOperation({ summary: 'Kanban da produção: muda a etapa (arrastar o card)' })
  moverEtapa(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(etapaOpSchema)) dto: EtapaOpDto,
  ) {
    return this.svc.moverEtapa(user, id, dto);
  }

  @Post(':id/cancelar')
  @ApiOperation({ summary: 'Cancela OP antes de ir pra facção' })
  cancelar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.cancelar(user, id);
  }
}
