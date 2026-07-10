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
  type AddBoardMembroDto,
  type AtividadesQueryDto,
  type BuscaQueryDto,
  type CreateBoardDto,
  type CreateListaDto,
  type UpdateBoardDto,
  addBoardMembroSchema,
  atividadesQuerySchema,
  buscaQuerySchema,
  createBoardSchema,
  createListaSchema,
  updateBoardSchema,
} from './kanban.dto';
import { KanbanBoardsService } from './kanban-boards.service';
import { KanbanListasService } from './kanban-listas.service';

@ApiTags('kanban')
@ApiBearerAuth()
@Controller('kanban/boards')
export class KanbanBoardsController {
  constructor(
    private readonly boards: KanbanBoardsService,
    private readonly listas: KanbanListasService,
  ) {}

  @Get()
  @RequirePermissions({ module: 'quadros', action: 'view' })
  @ApiOperation({ summary: 'Meus quadros (diretor/admin: todos da empresa ativa)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.boards.list(user);
  }

  @Post()
  @RequirePermissions({ module: 'quadros', action: 'create' })
  @ApiOperation({ summary: 'Cria quadro (representante: máximo 1)' })
  @Audit({ action: 'create', resource: 'kanban_board', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createBoardSchema)) dto: CreateBoardDto,
  ) {
    return this.boards.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions({ module: 'quadros', action: 'view' })
  @ApiOperation({ summary: 'Quadro completo: listas + cards + etiquetas + membros' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.boards.findById(user, id);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @Audit({ action: 'update', resource: 'kanban_board', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBoardSchema)) dto: UpdateBoardDto,
  ) {
    return this.boards.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Arquiva o quadro (soft delete)' })
  @Audit({ action: 'archive', resource: 'kanban_board', resourceIdFrom: 'params.id' })
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.boards.archive(user, id);
  }

  // ─── Membros ────────────────────────────────────────────────────────

  @Post(':id/membros')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Convida membro da mesma empresa pro quadro' })
  @Audit({ action: 'add_member', resource: 'kanban_board', resourceIdFrom: 'params.id' })
  addMembro(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addBoardMembroSchema)) dto: AddBoardMembroDto,
  ) {
    return this.boards.addMembro(user, id, dto);
  }

  @Delete(':id/membros/:usuarioId')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'remove_member', resource: 'kanban_board', resourceIdFrom: 'params.id' })
  async removeMembro(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('usuarioId') usuarioId: string,
  ): Promise<void> {
    await this.boards.removeMembro(user, id, usuarioId);
  }

  // ─── Atividade e busca ──────────────────────────────────────────────

  @Get(':id/atividades')
  @RequirePermissions({ module: 'quadros', action: 'view' })
  @ApiOperation({ summary: 'Feed de atividade do quadro (paginado por ?limit&antes)' })
  atividades(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(atividadesQuerySchema)) query: AtividadesQueryDto,
  ) {
    return this.boards.atividades(user, id, query);
  }

  @Get(':id/busca')
  @RequirePermissions({ module: 'quadros', action: 'view' })
  @ApiOperation({ summary: 'Busca cards: ?q=&etiqueta=&membro=&vencimento=' })
  busca(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(buscaQuerySchema)) query: BuscaQueryDto,
  ) {
    return this.boards.busca(user, id, query);
  }

  // ─── Listas (criação aninhada no board) ─────────────────────────────

  @Post(':id/listas')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Cria lista no fim do quadro' })
  @Audit({ action: 'create_list', resource: 'kanban_board', resourceIdFrom: 'params.id' })
  createLista(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createListaSchema)) dto: CreateListaDto,
  ) {
    return this.listas.create(user, id, dto);
  }
}
