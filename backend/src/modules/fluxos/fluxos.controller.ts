import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { FluxosService } from './fluxos.service';
import { CronMetricsService } from './cron-metrics.service';
import {
  createFluxoSchema,
  updateFluxoSchema,
  listFluxosSchema,
  listExecucoesSchema,
  testarFluxoSchema,
  definirGatilhoSchema,
  importFluxoSchema,
  cronPreviewSchema,
  uploadFluxoMidiaSchema,
  type CreateFluxoDto,
  type UpdateFluxoDto,
  type ListFluxosDto,
  type ListExecucoesDto,
  type TestarFluxoDto,
  type DefinirGatilhoDto,
  type ImportFluxoDto,
  type CronPreviewDto,
  type UploadFluxoMidiaDto,
} from './fluxos.dto';
import { previewCrons, CRON_TZ_PADRAO } from './cron.util';

@ApiTags('fluxos')
@ApiBearerAuth()
@Controller('fluxos')
export class FluxosController {
  constructor(
    private readonly svc: FluxosService,
    private readonly cronMetrics: CronMetricsService,
  ) {}

  // ─── CRUD ────────────────────────────────────────────────────────

  // Fluxo com DONO (card 👤): a rota abre pra GERENTE/REP e o SERVICE decide
  // por dono — pessoal só o dono mexe; da empresa, só a gestão (como sempre).
  @Post()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Cria um novo fluxo de automação' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createFluxoSchema)) dto: CreateFluxoDto,
  ) {
    return this.svc.create(user, dto);
  }

  @Get()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Lista fluxos de automação da empresa' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listFluxosSchema)) params: ListFluxosDto,
  ) {
    return this.svc.list(user, params);
  }

  @Get(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Detalhes de um fluxo com nós e arestas' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.findOne(user, id);
  }

  // Fluxo com DONO (card 👤): a rota abre pra GERENTE/REP e o SERVICE decide
  // por dono — pessoal só o dono mexe; da empresa, só a gestão (como sempre).
  @Put(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Atualiza fluxo (com full-replace de nós/arestas se fornecidos)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFluxoSchema)) dto: UpdateFluxoDto,
  ) {
    return this.svc.update(user, id, dto);
  }

  // ─── Import / Export (arquivo .json) ─────────────────────────────

  // Fluxo com DONO (card 👤): a rota abre pra GERENTE/REP e o SERVICE decide
  // por dono — pessoal só o dono mexe; da empresa, só a gestão (como sempre).
  @Post('importar')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Importa um fluxo de um arquivo JSON (cria como RASCUNHO)' })
  importar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(importFluxoSchema)) dto: ImportFluxoDto,
  ) {
    return this.svc.importar(user, dto);
  }

  @Post('midia')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({
    summary: 'Sobe um anexo do nó Enviar WhatsApp pro Storage (retorna storagePath)',
  })
  uploadMidia(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(uploadFluxoMidiaSchema)) dto: UploadFluxoMidiaDto,
  ) {
    return this.svc.uploadMidia(user, dto);
  }

  // Fluxo com DONO (card 👤): a rota abre pra GERENTE/REP e o SERVICE decide
  // por dono — pessoal só o dono mexe; da empresa, só a gestão (como sempre).
  @Get(':id/exportar')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Exporta o fluxo como JSON (.json) pronto pra reimportar' })
  exportar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.exportar(user, id);
  }

  // ─── Favoritos ───────────────────────────────────────────────────
  //
  // Sem @Roles: favoritar é preferência PESSOAL de quem já enxerga o fluxo
  // (o service valida o tenant). Prender no ADMIN/DIRECTOR faria o SAC — que é
  // quem mais vive na lista de fluxos — não poder organizar a própria tela.

  @Put(':id/favorito')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marca o fluxo como favorito do usuário logado' })
  favoritar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.definirFavorito(user, id, true);
  }

  @Delete(':id/favorito')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desmarca o fluxo como favorito do usuário logado' })
  desfavoritar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.definirFavorito(user, id, false);
  }

  // ─── Ciclo de vida ───────────────────────────────────────────────

  // Fluxo com DONO (card 👤): a rota abre pra GERENTE/REP e o SERVICE decide
  // por dono — pessoal só o dono mexe; da empresa, só a gestão (como sempre).
  @Post(':id/ativar')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Ativa o fluxo (valida grafo antes)' })
  ativar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.ativar(user, id);
  }

  // Fluxo com DONO (card 👤): a rota abre pra GERENTE/REP e o SERVICE decide
  // por dono — pessoal só o dono mexe; da empresa, só a gestão (como sempre).
  @Post(':id/gatilho')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({
    summary: 'Define/atualiza SÓ o nó de gatilho (sem full-replace do grafo)',
  })
  definirGatilho(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(definirGatilhoSchema)) dto: DefinirGatilhoDto,
  ) {
    return this.svc.definirGatilho(user, id, dto);
  }

  // Fluxo com DONO (card 👤): a rota abre pra GERENTE/REP e o SERVICE decide
  // por dono — pessoal só o dono mexe; da empresa, só a gestão (como sempre).
  @Post(':id/pausar')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Pausa o fluxo (novos eventos não disparam)' })
  pausar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.pausar(user, id);
  }

  // Fluxo com DONO (card 👤): a rota abre pra GERENTE/REP e o SERVICE decide
  // por dono — pessoal só o dono mexe; da empresa, só a gestão (como sempre).
  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Arquiva o fluxo' })
  arquivar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.arquivar(user, id);
  }

  // Fluxo com DONO (card 👤): a rota abre pra GERENTE/REP e o SERVICE decide
  // por dono — pessoal só o dono mexe; da empresa, só a gestão (como sempre).
  @Post(':id/desarquivar')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({
    summary:
      'Desarquiva o fluxo (ARQUIVADO → RASCUNHO). Única rota de volta pra um fluxo arquivado — ' +
      'ativar continua exigindo revisão/validação de grafo normal depois.',
  })
  desarquivar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.desarquivar(user, id);
  }

  // Fluxo com DONO (card 👤): a rota abre pra GERENTE/REP e o SERVICE decide
  // por dono — pessoal só o dono mexe; da empresa, só a gestão (como sempre).
  @Delete(':id/permanente')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Exclui o fluxo PERMANENTEMENTE (apaga nós, arestas e execuções).' })
  excluir(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.excluirPermanente(user, id);
  }

  // ─── Execuções ───────────────────────────────────────────────────

  @Get(':id/execucoes')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Lista histórico de execuções do fluxo' })
  listExecucoes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listExecucoesSchema)) params: ListExecucoesDto,
  ) {
    return this.svc.listExecucoes(user, id, params);
  }

  @Post('execucoes/:execucaoId/cancelar')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Cancela uma execução em andamento' })
  cancelarExecucao(
    @CurrentUser() user: AuthenticatedUser,
    @Param('execucaoId') execucaoId: string,
  ) {
    return this.svc.cancelarExecucao(user, execucaoId);
  }

  // ─── Teste + Métricas ────────────────────────────────────────────

  // Fluxo com DONO (card 👤): a rota abre pra GERENTE/REP e o SERVICE decide
  // por dono — pessoal só o dono mexe; da empresa, só a gestão (como sempre).
  @Post('testar')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'REP')
  @ApiOperation({ summary: 'Dispara execução de teste manual' })
  testar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(testarFluxoSchema)) dto: TestarFluxoDto,
  ) {
    return this.svc.testar(user, dto);
  }

  @Post('cron/preview')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Valida expressão(ões) cron e devolve as próximas execuções' })
  cronPreview(@Body(new ZodValidationPipe(cronPreviewSchema)) dto: CronPreviewDto) {
    const exprs = dto.expressoes?.length ? dto.expressoes : dto.expressao ? [dto.expressao] : [];
    return previewCrons(exprs, dto.timezone ?? CRON_TZ_PADRAO, 5, dto.pularFeriados ?? false);
  }

  // ⚠ Declarar ANTES de `:id/metricas` — senão `:id` captura "cron".
  @Get('cron/metricas')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Latência de disparo dos crons agendados (média + percentis)' })
  cronMetricas() {
    return this.cronMetrics.obterMetricas();
  }

  @Get(':id/metricas')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({ summary: 'Métricas de execução do fluxo (total, taxa de sucesso, etc.)' })
  metricas(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.metricas(user, id);
  }
}
