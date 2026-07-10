import { Body, Controller, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type MoverListaDto,
  type UpdateListaDto,
  moverListaSchema,
  updateListaSchema,
} from './kanban.dto';
import { KanbanListasService } from './kanban-listas.service';

@ApiTags('kanban')
@ApiBearerAuth()
@Controller('kanban/listas')
export class KanbanListasController {
  constructor(private readonly listas: KanbanListasService) {}

  @Patch(':id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Renomeia / arquiva / restaura a lista' })
  @Audit({ action: 'update', resource: 'kanban_lista', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateListaSchema)) dto: UpdateListaDto,
  ) {
    return this.listas.update(user, id, dto);
  }

  @Patch(':id/mover')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Move a lista (posição fracionária estilo Trello)' })
  @Audit({ action: 'move', resource: 'kanban_lista', resourceIdFrom: 'params.id' })
  mover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moverListaSchema)) dto: MoverListaDto,
  ) {
    return this.listas.mover(user, id, dto);
  }
}
