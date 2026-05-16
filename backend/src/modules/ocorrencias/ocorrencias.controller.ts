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
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type AdicionarComentarioDto,
  type ChangeStatusOcorrenciaDto,
  type CreateOcorrenciaDto,
  type ListOcorrenciasDto,
  type ResolverDto,
  type UpdateOcorrenciaDto,
  adicionarComentarioSchema,
  changeStatusOcorrenciaSchema,
  createOcorrenciaSchema,
  listOcorrenciasSchema,
  resolverSchema,
  updateOcorrenciaSchema,
} from './ocorrencias.dto';
import { OcorrenciasService } from './ocorrencias.service';

@ApiTags('ocorrencias')
@ApiBearerAuth()
@Controller('ocorrencias')
export class OcorrenciasController {
  constructor(private readonly ocorrencias: OcorrenciasService) {}

  @Get('resumo')
  @RequirePermissions({ module: 'ocorrencias', action: 'view' })
  @ApiOperation({ summary: 'KPIs de SAC (abertas, SLA, severidade)' })
  resumo(@CurrentUser() user: AuthenticatedUser) {
    return this.ocorrencias.resumo(user);
  }

  @Get()
  @RequirePermissions({ module: 'ocorrencias', action: 'view' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listOcorrenciasSchema)) query: ListOcorrenciasDto,
  ) {
    return this.ocorrencias.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'ocorrencias', action: 'view' })
  @ApiOperation({ summary: 'Detalhe da ocorrência (incl. timeline de comentários)' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ocorrencias.findById(user, id);
  }

  @Post()
  @RequirePermissions({ module: 'ocorrencias', action: 'create' })
  @Audit({ action: 'create', resource: 'ocorrencia', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOcorrenciaSchema)) dto: CreateOcorrenciaDto,
  ) {
    return this.ocorrencias.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'ocorrencias', action: 'edit' })
  @Audit({ action: 'update', resource: 'ocorrencia', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOcorrenciaSchema)) dto: UpdateOcorrenciaDto,
  ) {
    return this.ocorrencias.update(user, id, dto);
  }

  @Put(':id/status')
  @RequirePermissions({ module: 'ocorrencias', action: 'edit' })
  @Audit({ action: 'change_status', resource: 'ocorrencia', resourceIdFrom: 'params.id' })
  changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeStatusOcorrenciaSchema)) dto: ChangeStatusOcorrenciaDto,
  ) {
    return this.ocorrencias.changeStatus(user, id, dto);
  }

  @Post(':id/resolver')
  @RequirePermissions({ module: 'ocorrencias', action: 'edit' })
  @Audit({ action: 'resolver', resource: 'ocorrencia', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Marca como RESOLVIDA com texto de resolução' })
  resolver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolverSchema)) dto: ResolverDto,
  ) {
    return this.ocorrencias.resolver(user, id, dto);
  }

  @Post(':id/comentarios')
  @RequirePermissions({ module: 'ocorrencias', action: 'edit' })
  @Audit({ action: 'comentar', resource: 'ocorrencia', resourceIdFrom: 'params.id' })
  comentar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adicionarComentarioSchema)) dto: AdicionarComentarioDto,
  ) {
    return this.ocorrencias.adicionarComentario(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions({ module: 'ocorrencias', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'ocorrencia', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.ocorrencias.remove(user, id);
  }
}
