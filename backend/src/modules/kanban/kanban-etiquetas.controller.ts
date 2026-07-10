import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateEtiquetaDto,
  type UpdateEtiquetaDto,
  createEtiquetaSchema,
  updateEtiquetaSchema,
} from './kanban.dto';
import { KanbanEtiquetasService } from './kanban-etiquetas.service';

@ApiTags('kanban')
@ApiBearerAuth()
@Controller('kanban')
export class KanbanEtiquetasController {
  constructor(private readonly etiquetas: KanbanEtiquetasService) {}

  @Post('boards/:id/etiquetas')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Cria etiqueta no quadro (cor + nome opcional)' })
  @Audit({ action: 'create', resource: 'kanban_etiqueta', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') boardId: string,
    @Body(new ZodValidationPipe(createEtiquetaSchema)) dto: CreateEtiquetaDto,
  ) {
    return this.etiquetas.create(user, boardId, dto);
  }

  @Patch('etiquetas/:id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @Audit({ action: 'update', resource: 'kanban_etiqueta', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEtiquetaSchema)) dto: UpdateEtiquetaDto,
  ) {
    return this.etiquetas.update(user, id, dto);
  }

  @Delete('etiquetas/:id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'kanban_etiqueta', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.etiquetas.remove(user, id);
  }
}
