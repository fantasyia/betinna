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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  MOTIVOS_GANHO,
  MOTIVOS_PERDA,
  PROBABILIDADE_POR_ETAPA,
  SLA_DIAS_POR_ETAPA,
  TRANSICOES_ETAPA,
} from './leads.constants';
import {
  type AdicionarTagLeadDto,
  type AtribuirRepDto,
  type CreateLeadDto,
  type ListLeadsDto,
  type MoverEtapaDto,
  type UpdateLeadDto,
  adicionarTagLeadSchema,
  atribuirRepSchema,
  createLeadSchema,
  listLeadsSchema,
  moverEtapaSchema,
  updateLeadSchema,
} from './leads.dto';
import { LeadsService } from './leads.service';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get('metadata')
  @RequirePermissions({ module: 'kanban', action: 'view' })
  @ApiOperation({
    summary: 'Constantes do kanban (probabilidades, SLAs, motivos, transições)',
  })
  metadata() {
    return {
      probabilidadePorEtapa: PROBABILIDADE_POR_ETAPA,
      slaDiasPorEtapa: SLA_DIAS_POR_ETAPA,
      transicoesValidas: TRANSICOES_ETAPA,
      motivosGanho: MOTIVOS_GANHO,
      motivosPerda: MOTIVOS_PERDA,
    };
  }

  @Get('pipeline')
  @RequirePermissions({ module: 'kanban', action: 'view' })
  @ApiOperation({ summary: 'Resumo do pipeline (valor por etapa + ponderado + aging)' })
  pipeline(@CurrentUser() user: AuthenticatedUser) {
    return this.leads.resumoPipeline(user);
  }

  @Get('kanban')
  @RequirePermissions({ module: 'kanban', action: 'view' })
  @ApiOperation({
    summary: 'Leads agrupados por etapa. Aceita ?funilId pra escolher funil específico.',
  })
  kanban(@CurrentUser() user: AuthenticatedUser, @Query('funilId') funilId?: string) {
    return this.leads.kanban(user, funilId);
  }

  @Get()
  @RequirePermissions({ module: 'kanban', action: 'view' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listLeadsSchema)) query: ListLeadsDto,
  ) {
    return this.leads.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'kanban', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.leads.findById(user, id);
  }

  @Post()
  @RequirePermissions({ module: 'kanban', action: 'create' })
  @Audit({ action: 'create', resource: 'lead', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createLeadSchema)) dto: CreateLeadDto,
  ) {
    return this.leads.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'update', resource: 'lead', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLeadSchema)) dto: UpdateLeadDto,
  ) {
    return this.leads.update(user, id, dto);
  }

  @Put(':id/etapa')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'mover_etapa', resource: 'lead', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Move lead na máquina de estados. GANHO/PERDIDO exigem motivo. Reabrir PERDIDO → NOVO.',
  })
  moverEtapa(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moverEtapaSchema)) dto: MoverEtapaDto,
  ) {
    return this.leads.moverEtapa(user, id, dto);
  }

  @Put(':id/representante')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'atribuir_rep', resource: 'lead', resourceIdFrom: 'params.id' })
  atribuirRep(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(atribuirRepSchema)) dto: AtribuirRepDto,
  ) {
    return this.leads.atribuirRep(user, id, dto);
  }

  @Post(':id/tags')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'adicionar_tag', resource: 'lead', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Aplica uma tag (existente) ao lead' })
  adicionarTag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adicionarTagLeadSchema)) dto: AdicionarTagLeadDto,
  ) {
    return this.leads.adicionarTag(user, id, dto.tagId);
  }

  @Delete(':id/tags/:tagId')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @Audit({ action: 'remover_tag', resource: 'lead', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Remove uma tag do lead' })
  removerTag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    return this.leads.removerTag(user, id, tagId);
  }

  @Delete(':id')
  // Blindagem: gate granular colapsa edit→delete (REP teria delete de lead). @Roles tranca em gestão.
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @RequirePermissions({ module: 'kanban', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'lead', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.leads.remove(user, id);
  }
}
