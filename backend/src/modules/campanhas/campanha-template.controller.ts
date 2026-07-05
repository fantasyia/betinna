import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  createCampanhaTemplateSchema,
  updateCampanhaTemplateSchema,
  type CreateCampanhaTemplateDto,
  type UpdateCampanhaTemplateDto,
} from './campanha-template.dto';
import { CampanhaTemplateService } from './campanha-template.service';

/**
 * Biblioteca de templates de campanha (escopo empresa). Path TOP-LEVEL
 * `campanha-templates` (NÃO `campanhas/templates`) de propósito: aninhar sob
 * /campanhas fazia o `@Get(':id')` do CampanhasController capturar "templates"
 * e devolver 404 — e reordenar controllers não resolveu nesta versão do Nest.
 * Mesma matriz de permissão do módulo campanhas.
 */
@ApiTags('campanhas')
@ApiBearerAuth()
@Controller('campanha-templates')
export class CampanhaTemplateController {
  constructor(private readonly svc: CampanhaTemplateService) {}

  @Get()
  @RequirePermissions({ module: 'campanhas', action: 'view' })
  @ApiOperation({ summary: 'Lista os templates de campanha da empresa' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(user);
  }

  @Post()
  @RequirePermissions({ module: 'campanhas', action: 'create' })
  @Audit({ action: 'create', resource: 'campanha_template', resourceIdFrom: 'response.id' })
  @ApiOperation({ summary: 'Salva um novo template de campanha' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCampanhaTemplateSchema)) dto: CreateCampanhaTemplateDto,
  ) {
    return this.svc.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'campanhas', action: 'edit' })
  @Audit({ action: 'update', resource: 'campanha_template', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Atualiza um template de campanha' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCampanhaTemplateSchema)) dto: UpdateCampanhaTemplateDto,
  ) {
    return this.svc.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions({ module: 'campanhas', action: 'delete' })
  @Audit({ action: 'delete', resource: 'campanha_template', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Remove um template de campanha' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
