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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateCardDto,
  type MoverCardDto,
  type UpdateCardDto,
  createCardSchema,
  moverCardSchema,
  updateCardSchema,
} from './kanban.dto';
import { KanbanCardsService } from './kanban-cards.service';
import { KanbanEtiquetasService } from './kanban-etiquetas.service';

@ApiTags('kanban')
@ApiBearerAuth()
@Controller('kanban')
export class KanbanCardsController {
  constructor(
    private readonly cards: KanbanCardsService,
    private readonly etiquetas: KanbanEtiquetasService,
  ) {}

  @Post('listas/:id/cards')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Cria card no fim da lista' })
  @Audit({ action: 'create', resource: 'kanban_card', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') listaId: string,
    @Body(new ZodValidationPipe(createCardSchema)) dto: CreateCardDto,
  ) {
    return this.cards.create(user, listaId, dto);
  }

  @Get('cards/:id')
  @RequirePermissions({ module: 'quadros', action: 'view' })
  @ApiOperation({ summary: 'Card completo: checklists, comentários, anexos, atividade' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cards.findById(user, id);
  }

  @Patch('cards/:id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Título, descrição, datas, concluído, capa, arquivar' })
  @Audit({ action: 'update', resource: 'kanban_card', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCardSchema)) dto: UpdateCardDto,
  ) {
    return this.cards.update(user, id, dto);
  }

  @Patch('cards/:id/mover')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Move o card (drag & drop): { listaId, posicao }' })
  @Audit({ action: 'move', resource: 'kanban_card', resourceIdFrom: 'params.id' })
  mover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moverCardSchema)) dto: MoverCardDto,
  ) {
    return this.cards.mover(user, id, dto);
  }

  // ─── Etiquetas no card ──────────────────────────────────────────────

  @Post('cards/:id/etiquetas/:etiquetaId')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @Audit({ action: 'add_label', resource: 'kanban_card', resourceIdFrom: 'params.id' })
  aplicarEtiqueta(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('etiquetaId') etiquetaId: string,
  ) {
    return this.etiquetas.aplicarNoCard(user, id, etiquetaId);
  }

  @Delete('cards/:id/etiquetas/:etiquetaId')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'remove_label', resource: 'kanban_card', resourceIdFrom: 'params.id' })
  async removerEtiqueta(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('etiquetaId') etiquetaId: string,
  ): Promise<void> {
    await this.etiquetas.removerDoCard(user, id, etiquetaId);
  }

  // ─── Membros do card ────────────────────────────────────────────────

  @Post('cards/:id/membros/:usuarioId')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @Audit({ action: 'add_member', resource: 'kanban_card', resourceIdFrom: 'params.id' })
  addMembro(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('usuarioId') usuarioId: string,
  ) {
    return this.cards.addMembro(user, id, usuarioId);
  }

  @Delete('cards/:id/membros/:usuarioId')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'remove_member', resource: 'kanban_card', resourceIdFrom: 'params.id' })
  async removeMembro(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('usuarioId') usuarioId: string,
  ): Promise<void> {
    await this.cards.removeMembro(user, id, usuarioId);
  }
}
