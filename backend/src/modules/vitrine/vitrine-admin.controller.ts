import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CorDto,
  type LinhaDto,
  type ModeloDto,
  type TamanhoDto,
  type VariacaoPatchDto,
  type VitrineConfigDto,
  corSchema,
  linhaSchema,
  modeloSchema,
  tamanhoSchema,
  variacaoPatchSchema,
  vitrineConfigSchema,
} from './vitrine.dto';
import { VitrineAdminService } from './vitrine-admin.service';

/**
 * Vitrine de atacado — cadastro do lado da empresa (Fase 1).
 *
 * Só ADMIN/DIRECTOR: é o catálogo e o preço da empresa. Toda rota de catálogo
 * exige a vitrine ligada (o service recusa com 422) — empresa sem vitrine não
 * enxerga nada daqui.
 */
@ApiTags('vitrine')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('vitrine/admin')
export class VitrineAdminController {
  constructor(private readonly svc: VitrineAdminService) {}

  @Get('config')
  @ApiOperation({ summary: 'Configuração da vitrine da empresa ativa (null = desligada)' })
  obterConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.obterConfig(user);
  }

  @Put('config')
  @ApiOperation({ summary: 'Liga/configura a vitrine (endereço e faixas de preço)' })
  salvarConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(vitrineConfigSchema)) dto: VitrineConfigDto,
  ) {
    return this.svc.salvarConfig(user, dto);
  }

  // ─── Cores ──────────────────────────────────────────────────────────────
  @Get('cores')
  listarCores(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listarCores(user);
  }

  @Post('cores')
  criarCor(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(corSchema)) dto: CorDto,
  ) {
    return this.svc.criarCor(user, dto);
  }

  @Put('cores/:id')
  atualizarCor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(corSchema)) dto: CorDto,
  ) {
    return this.svc.atualizarCor(user, id, dto);
  }

  @Delete('cores/:id')
  excluirCor(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.excluirCor(user, id);
  }

  // ─── Linhas e tamanhos ──────────────────────────────────────────────────
  @Get('linhas')
  listarLinhas(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listarLinhas(user);
  }

  @Post('linhas')
  criarLinha(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(linhaSchema)) dto: LinhaDto,
  ) {
    return this.svc.criarLinha(user, dto);
  }

  @Put('linhas/:id')
  atualizarLinha(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(linhaSchema)) dto: LinhaDto,
  ) {
    return this.svc.atualizarLinha(user, id, dto);
  }

  @Post('linhas/:id/tamanhos')
  criarTamanho(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') linhaId: string,
    @Body(new ZodValidationPipe(tamanhoSchema)) dto: TamanhoDto,
  ) {
    return this.svc.criarTamanho(user, linhaId, dto);
  }

  @Put('tamanhos/:id')
  atualizarTamanho(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(tamanhoSchema)) dto: TamanhoDto,
  ) {
    return this.svc.atualizarTamanho(user, id, dto);
  }

  // ─── Modelos ────────────────────────────────────────────────────────────
  @Get('modelos')
  listarModelos(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listarModelos(user);
  }

  @Get('modelos/:id')
  obterModelo(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.obterModelo(user, id);
  }

  @Post('modelos')
  @ApiOperation({ summary: 'Cria um modelo com cores, linhas, tamanhos e preços' })
  criarModelo(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(modeloSchema)) dto: ModeloDto,
  ) {
    return this.svc.criarModelo(user, dto);
  }

  @Put('modelos/:id')
  @ApiOperation({ summary: 'Atualiza o modelo; campo ausente = não mexe naquela parte' })
  atualizarModelo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(modeloSchema)) dto: ModeloDto,
  ) {
    return this.svc.atualizarModelo(user, id, dto);
  }

  @Patch('variacoes/:id')
  @ApiOperation({ summary: 'SKU e estoque de uma variação (opcionais nesta fase)' })
  atualizarVariacao(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(variacaoPatchSchema)) dto: VariacaoPatchDto,
  ) {
    return this.svc.atualizarVariacao(user, id, dto);
  }
}
