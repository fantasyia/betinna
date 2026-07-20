import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateFunilDto,
  type CreateFunilEtapaDto,
  type LeadsPorEtapaQueryDto,
  type ReordenarEtapasDto,
  type UpdateFunilDto,
  type UpdateFunilEtapaDto,
  createFunilEtapaSchema,
  createFunilSchema,
  leadsPorEtapaQuerySchema,
  reordenarEtapasSchema,
  updateFunilEtapaSchema,
  updateFunilSchema,
} from './funis.dto';
import { FunisService } from './funis.service';
import {
  type AtribuicaoPorCampanhaQueryDto,
  type HistoricoEtapasQueryDto,
  atribuicaoPorCampanhaQuerySchema,
  historicoEtapasQuerySchema,
} from '@modules/leads/leads.dto';

@ApiTags('funis')
@ApiBearerAuth()
@Controller('funis')
export class FunisController {
  constructor(private readonly funis: FunisService) {}

  @Get()
  @RequirePermissions({ module: 'kanban', action: 'view' })
  @ApiOperation({ summary: 'Lista funis da empresa (padrão primeiro)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.funis.list(user);
  }

  // ⚠️ Rotas literais ANTES de :id (senão o findOne engole "etapa-historico"/etc).
  @Get('atribuicao-campanha')
  @RequirePermissions({ module: 'kanban', action: 'view' })
  @ApiOperation({
    summary:
      'Atribuição por campanha (leads/etapa/valor/ciclo). utmCampaign ausente = sem atribuição. ' +
      'MCP atribuicao_por_campanha',
  })
  atribuicaoCampanha(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(atribuicaoPorCampanhaQuerySchema))
    query: AtribuicaoPorCampanhaQueryDto,
  ) {
    return this.funis.atribuicaoPorCampanha(user, query);
  }

  @Get('etapa-historico')
  @RequirePermissions({ module: 'kanban', action: 'view' })
  @ApiOperation({
    summary: 'Histórico de transição de etapas (filtro funil/lead/período) — MCP etapa_historico',
  })
  etapaHistorico(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(historicoEtapasQuerySchema)) query: HistoricoEtapasQueryDto,
  ) {
    return this.funis.historicoEtapas(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'kanban', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.funis.findById(user, id);
  }

  @Get(':id/etapas/:etapaId/leads')
  @RequirePermissions({ module: 'kanban', action: 'view' })
  @ApiOperation({ summary: 'Leads dentro de uma etapa do funil (paginado, mais parados primeiro)' })
  leadsPorEtapa(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('etapaId') etapaId: string,
    @Query(new ZodValidationPipe(leadsPorEtapaQuerySchema)) query: LeadsPorEtapaQueryDto,
  ) {
    return this.funis.leadsPorEtapa(user, id, etapaId, query);
  }

  @Post()
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'create', resource: 'funil', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createFunilSchema)) dto: CreateFunilDto,
  ) {
    return this.funis.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'update', resource: 'funil', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFunilSchema)) dto: UpdateFunilDto,
  ) {
    return this.funis.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'delete', resource: 'funil', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.funis.remove(user, id);
    return { ok: true };
  }

  // ─── Etapas ──────────────────────────────────────────────────────

  @Post(':id/etapas')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'add_etapa', resource: 'funil', resourceIdFrom: 'params.id' })
  adicionarEtapa(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createFunilEtapaSchema)) dto: CreateFunilEtapaDto,
  ) {
    return this.funis.adicionarEtapa(user, id, dto);
  }

  @Patch(':id/etapas/:etapaId')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'update_etapa', resource: 'funil', resourceIdFrom: 'params.id' })
  atualizarEtapa(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('etapaId') etapaId: string,
    @Body(new ZodValidationPipe(updateFunilEtapaSchema)) dto: UpdateFunilEtapaDto,
  ) {
    return this.funis.atualizarEtapa(user, id, etapaId, dto);
  }

  @Delete(':id/etapas/:etapaId')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'delete_etapa', resource: 'funil', resourceIdFrom: 'params.id' })
  removerEtapa(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('etapaId') etapaId: string,
  ) {
    return this.funis.removerEtapa(user, id, etapaId);
  }

  @Put(':id/etapas/reordenar')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'reorder_etapas', resource: 'funil', resourceIdFrom: 'params.id' })
  reordenar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reordenarEtapasSchema)) dto: ReordenarEtapasDto,
  ) {
    return this.funis.reordenarEtapas(user, id, dto);
  }
}
