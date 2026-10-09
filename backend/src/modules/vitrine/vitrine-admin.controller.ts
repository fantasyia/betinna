import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CategoriaDto,
  type CorDto,
  type OrdemModelosDto,
  categoriaSchema,
  ordemModelosSchema,
  type LinhaDto,
  type ModeloDto,
  type TamanhoDto,
  type VariacaoPatchDto,
  type VitrineConfigDto,
  type FreteConfigDto,
  type PrivacidadeConfigDto,
  type PixelConfigDto,
  corSchema,
  pixelConfigSchema,
  privacidadeConfigSchema,
  freteConfigSchema,
  simularFreteSchema,
  linhaSchema,
  modeloSchema,
  tamanhoSchema,
  variacaoPatchSchema,
  vitrineConfigSchema,
} from './vitrine.dto';
import { VitrineAdminService } from './vitrine-admin.service';
import { FreteService } from './frete.service';
import { PrivacidadeService } from './privacidade.service';
import { MetaPixelService } from './meta-pixel.service';

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
  constructor(
    private readonly svc: VitrineAdminService,
    private readonly frete: FreteService,
    private readonly privacidade: PrivacidadeService,
    private readonly pixel: MetaPixelService,
  ) {}

  // ─── Pixel do Meta ───────────────────────────────────────────────────────
  @Get('pixel')
  @ApiOperation({ summary: 'Pixel do Meta: ID, ligado e se o token (CAPI) está conectado' })
  pixelStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.pixel.status(user);
  }

  @Put('pixel')
  @ApiOperation({ summary: 'Salva o ID do pixel e liga/desliga (exige o token em Integrações)' })
  pixelSalvar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(pixelConfigSchema)) dto: PixelConfigDto,
  ) {
    return this.pixel.salvar(user, dto);
  }

  // ─── Política de Privacidade ────────────────────────────────────────────
  @Get('privacidade')
  @ApiOperation({ summary: 'Razão social e e-mail da política de privacidade (publicada?)' })
  privacidadeStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.privacidade.status(user);
  }

  @Put('privacidade')
  @ApiOperation({
    summary: 'Salva quem responde pelos dados e o e-mail de contato (publica a página)',
  })
  privacidadeSalvar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(privacidadeConfigSchema)) dto: PrivacidadeConfigDto,
  ) {
    return this.privacidade.salvar(user, dto);
  }

  // ─── Frete (Melhor Envio) ───────────────────────────────────────────────
  @Get('frete')
  @ApiOperation({ summary: 'Frete da vitrine: config, Melhor Envio conectado e o que falta' })
  freteStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.frete.status(user);
  }

  @Put('frete')
  @ApiOperation({ summary: 'Salva CEP de origem, caixas, teto por volume e retirada' })
  freteSalvar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(freteConfigSchema)) dto: FreteConfigDto,
  ) {
    return this.frete.salvar(user, dto);
  }

  @Post('frete/simular')
  @ApiOperation({ summary: 'Cota N peças de X gramas pra um CEP (confere antes de ligar)' })
  freteSimular(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(simularFreteSchema))
    dto: { cep: string; pecas: number; pesoG: number; valor: number },
  ) {
    return this.frete.simular(user, dto);
  }

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

  // ─── Categorias ─────────────────────────────────────────────────────────
  @Get('categorias')
  listarCategorias(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listarCategorias(user);
  }

  @Post('categorias')
  criarCategoria(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(categoriaSchema)) dto: CategoriaDto,
  ) {
    return this.svc.criarCategoria(user, dto);
  }

  @Put('categorias/:id')
  atualizarCategoria(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(categoriaSchema)) dto: CategoriaDto,
  ) {
    return this.svc.atualizarCategoria(user, id, dto);
  }

  @Delete('categorias/:id')
  excluirCategoria(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.excluirCategoria(user, id);
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

  @Delete('linhas/:id')
  @ApiOperation({ summary: 'Exclui a linha (só se nenhum modelo usa)' })
  excluirLinha(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.excluirLinha(user, id);
  }

  @Delete('tamanhos/:id')
  @ApiOperation({ summary: 'Exclui o tamanho (só se nenhum modelo usa)' })
  excluirTamanho(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.excluirTamanho(user, id);
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

  // `ordem` antes de `:id`: senão o PUT cairia em modelos/:id.
  @Put('modelos/ordem')
  @ApiOperation({ summary: 'Ordem dos modelos na vitrine (todos os ids, na ordem)' })
  reordenarModelos(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ordemModelosSchema)) dto: OrdemModelosDto,
  ) {
    return this.svc.reordenarModelos(user, dto.ids);
  }

  @Delete('modelos/:id')
  @ApiOperation({ summary: 'Exclui o modelo (produtos ficam desativados; mídia sai do bucket)' })
  excluirModelo(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.excluirModelo(user, id);
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
