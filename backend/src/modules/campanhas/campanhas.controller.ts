import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type AgendarCampanhaDto,
  type AnalisarResultadoDto,
  type CreateCampanhaDto,
  type GerarConteudoDto,
  type ListCampanhasDto,
  type OtimizarMensagemDto,
  type SugerirSegmentoDto,
  type UpdateCampanhaDto,
  agendarCampanhaSchema,
  analisarResultadoSchema,
  createCampanhaSchema,
  gerarConteudoSchema,
  listCampanhasSchema,
  otimizarMensagemSchema,
  sugerirSegmentoSchema,
  updateCampanhaSchema,
} from './campanhas.dto';
import { CampanhaIaService } from './campanha-ia.service';
import { CampanhasService } from './campanhas.service';

@ApiTags('campanhas')
@ApiBearerAuth()
@Controller('campanhas')
export class CampanhasController {
  constructor(
    private readonly campanhas: CampanhasService,
    private readonly campanhaIa: CampanhaIaService,
  ) {}

  // ─── Dashboard ───────────────────────────────────────────────────────────

  @Get('resumo')
  @RequirePermissions({ module: 'campanhas', action: 'view' })
  @ApiOperation({
    summary: 'Dashboard de campanhas (contagens por status + alcance últimos 30 dias)',
  })
  resumo(@CurrentUser() user: AuthenticatedUser) {
    return this.campanhas.resumo(user);
  }

  // ─── IA ──────────────────────────────────────────────────────────────────

  @Post('ia/gerar-conteudo')
  @RequirePermissions({ module: 'campanhas', action: 'create' })
  @ApiOperation({
    summary:
      'IA: gera mensagem WA + email + assunto + variações com base no objetivo, tom e segmento. ' +
      'Usa perfil da empresa (produtos, segmentos de clientes) como contexto.',
  })
  gerarConteudo(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(gerarConteudoSchema)) dto: GerarConteudoDto,
  ) {
    return this.campanhaIa.gerarConteudo(user, dto);
  }

  @Post('ia/otimizar')
  @RequirePermissions({ module: 'campanhas', action: 'edit' })
  @ApiOperation({
    summary:
      'IA: melhora uma mensagem existente, retorna versão otimizada + 2 variações + dicas de copywriting.',
  })
  otimizarMensagem(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(otimizarMensagemSchema)) dto: OtimizarMensagemDto,
  ) {
    return this.campanhaIa.otimizarMensagem(user, dto);
  }

  @Post('ia/sugerir-segmento')
  @RequirePermissions({ module: 'campanhas', action: 'create' })
  @ApiOperation({
    summary:
      'IA: analisa a base de clientes da empresa e sugere o melhor segmento para o objetivo informado, ' +
      'incluindo tags recomendadas, tom ideal e melhor horário de envio.',
  })
  sugerirSegmento(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(sugerirSegmentoSchema)) dto: SugerirSegmentoDto,
  ) {
    return this.campanhaIa.sugerirSegmento(user, dto);
  }

  @Get(':id/ia/analisar')
  @RequirePermissions({ module: 'campanhas', action: 'view' })
  @ApiOperation({
    summary:
      'IA: analisa os resultados de uma campanha enviada e retorna insights acionáveis, ' +
      'pontos fortes, melhorias, recomendações para próximas campanhas e score de performance (1–10).',
  })
  analisarResultado(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(analisarResultadoSchema)) dto: AnalisarResultadoDto,
  ) {
    return this.campanhaIa.analisarResultado(user, id, dto);
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  @Get()
  @RequirePermissions({ module: 'campanhas', action: 'view' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listCampanhasSchema)) query: ListCampanhasDto,
  ) {
    return this.campanhas.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'campanhas', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.campanhas.findById(user, id);
  }

  @Get(':id/metricas')
  @RequirePermissions({ module: 'campanhas', action: 'view' })
  @ApiOperation({ summary: 'Métricas de envio por campanha (taxa envio, leitura, erros)' })
  metricas(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.campanhas.metricas(user, id);
  }

  @Post()
  @RequirePermissions({ module: 'campanhas', action: 'create' })
  @Audit({ action: 'create', resource: 'campanha', resourceIdFrom: 'response.id' })
  @ApiOperation({
    summary:
      'Cria campanha como RASCUNHO (ou AGENDADA se agendadoPara informado). ' +
      'Informe `objetivo` para enriquecer análises de IA. ' +
      'Ative `usarIaPersonalizacao: true` para que cada mensagem seja personalizada individualmente pela IA no envio.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCampanhaSchema)) dto: CreateCampanhaDto,
  ) {
    return this.campanhas.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'campanhas', action: 'edit' })
  @Audit({ action: 'update', resource: 'campanha', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCampanhaSchema)) dto: UpdateCampanhaDto,
  ) {
    return this.campanhas.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions({ module: 'campanhas', action: 'delete' })
  @Audit({ action: 'delete', resource: 'campanha', resourceIdFrom: 'params.id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.campanhas.remove(user, id);
  }

  // ─── Workflow ────────────────────────────────────────────────────────────

  @Post(':id/agendar')
  @RequirePermissions({ module: 'campanhas', action: 'edit' })
  @Audit({ action: 'agendar', resource: 'campanha', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Agenda campanha para disparo futuro' })
  agendar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(agendarCampanhaSchema)) dto: AgendarCampanhaDto,
  ) {
    return this.campanhas.agendar(user, id, dto);
  }

  @Post(':id/disparar')
  @RequirePermissions({ module: 'campanhas', action: 'edit' })
  @Audit({ action: 'disparar', resource: 'campanha', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Dispara imediatamente. Resolve segmento, cria destinatários e enfileira envios via BullMQ. ' +
      'Se `usarIaPersonalizacao=true`, cada mensagem é personalizada pela IA antes do envio.',
  })
  @HttpCode(HttpStatus.ACCEPTED)
  disparar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.campanhas.disparar(user, id);
  }

  @Post(':id/pausar')
  @RequirePermissions({ module: 'campanhas', action: 'edit' })
  @Audit({ action: 'pausar', resource: 'campanha', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Pausa campanha em ENVIANDO (jobs pendentes são ignorados pelo processor)',
  })
  pausar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.campanhas.pausar(user, id);
  }

  @Post(':id/cancelar')
  @RequirePermissions({ module: 'campanhas', action: 'edit' })
  @Audit({ action: 'cancelar', resource: 'campanha', resourceIdFrom: 'params.id' })
  cancelar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.campanhas.cancelar(user, id);
  }
}
