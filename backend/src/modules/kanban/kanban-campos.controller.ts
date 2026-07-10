import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateCampoDto,
  type SetCampoValorDto,
  type UpdateCampoDto,
  createCampoSchema,
  setCampoValorSchema,
  updateCampoSchema,
} from './kanban.dto';
import { KanbanCamposService } from './kanban-campos.service';

@ApiTags('kanban')
@ApiBearerAuth()
@Controller('kanban')
export class KanbanCamposController {
  constructor(private readonly campos: KanbanCamposService) {}

  @Post('boards/:id/campos')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: '★ Cria campo personalizado (texto/numero/data/checkbox/lista_opcoes)' })
  @Audit({ action: 'create', resource: 'kanban_campo', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') boardId: string,
    @Body(new ZodValidationPipe(createCampoSchema)) dto: CreateCampoDto,
  ) {
    return this.campos.create(user, boardId, dto);
  }

  @Patch('campos/:id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @Audit({ action: 'update', resource: 'kanban_campo', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCampoSchema)) dto: UpdateCampoDto,
  ) {
    return this.campos.update(user, id, dto);
  }

  @Delete('campos/:id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'kanban_campo', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.campos.remove(user, id);
  }

  @Put('cards/:cardId/campos/:campoId')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: '★ Define o valor do campo no card (null limpa)' })
  @Audit({ action: 'set_value', resource: 'kanban_campo', resourceIdFrom: 'params.campoId' })
  setValor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cardId') cardId: string,
    @Param('campoId') campoId: string,
    @Body(new ZodValidationPipe(setCampoValorSchema)) dto: SetCampoValorDto,
  ) {
    return this.campos.setValor(user, cardId, campoId, dto);
  }
}
