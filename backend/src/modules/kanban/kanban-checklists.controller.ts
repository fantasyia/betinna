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
  type CreateChecklistDto,
  type CreateChecklistItemDto,
  type MeusItensQueryDto,
  type UpdateChecklistDto,
  type UpdateChecklistItemDto,
  createChecklistItemSchema,
  createChecklistSchema,
  meusItensQuerySchema,
  updateChecklistItemSchema,
  updateChecklistSchema,
} from './kanban.dto';
import { KanbanChecklistsService } from './kanban-checklists.service';

@ApiTags('kanban')
@ApiBearerAuth()
@Controller('kanban')
export class KanbanChecklistsController {
  constructor(private readonly checklists: KanbanChecklistsService) {}

  /** ★ Painel pessoal: itens delegados a mim em todos os quadros, por prazo. */
  @Get('meus-itens')
  @RequirePermissions({ module: 'quadros', action: 'view' })
  @ApiOperation({ summary: '★ Itens de checklist delegados a mim (todos os quadros)' })
  meusItens(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(meusItensQuerySchema)) query: MeusItensQueryDto,
  ) {
    return this.checklists.meusItens(user, query);
  }

  @Post('cards/:id/checklists')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Cria checklist no card (opcionalmente já com itens ★)' })
  @Audit({ action: 'create', resource: 'kanban_checklist', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') cardId: string,
    @Body(new ZodValidationPipe(createChecklistSchema)) dto: CreateChecklistDto,
  ) {
    return this.checklists.create(user, cardId, dto);
  }

  @Patch('checklists/:id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @Audit({ action: 'update', resource: 'kanban_checklist', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateChecklistSchema)) dto: UpdateChecklistDto,
  ) {
    return this.checklists.update(user, id, dto);
  }

  @Delete('checklists/:id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'kanban_checklist', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.checklists.remove(user, id);
  }

  @Post('checklists/:id/itens')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Adiciona item (aceita prazo ★ e responsável ★)' })
  @Audit({ action: 'create', resource: 'kanban_checklist_item', resourceIdFrom: 'response.id' })
  createItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') checklistId: string,
    @Body(new ZodValidationPipe(createChecklistItemSchema)) dto: CreateChecklistItemDto,
  ) {
    return this.checklists.createItem(user, checklistId, dto);
  }

  @Patch('checklist-itens/:id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Texto, concluído, posição, prazo ★, responsável ★' })
  @Audit({ action: 'update', resource: 'kanban_checklist_item', resourceIdFrom: 'params.id' })
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateChecklistItemSchema)) dto: UpdateChecklistItemDto,
  ) {
    return this.checklists.updateItem(user, id, dto);
  }

  @Delete('checklist-itens/:id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'kanban_checklist_item', resourceIdFrom: 'params.id' })
  async removeItem(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.checklists.removeItem(user, id);
  }
}
