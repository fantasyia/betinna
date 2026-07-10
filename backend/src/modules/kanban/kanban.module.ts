import { Module } from '@nestjs/common';
import { KanbanAcessoService } from './kanban-acesso.service';
import { KanbanAnexosService } from './kanban-anexos.service';
import { KanbanAtividadeService } from './kanban-atividade.service';
import { KanbanBoardsController } from './kanban-boards.controller';
import { KanbanBoardsService } from './kanban-boards.service';
import { KanbanCamposController } from './kanban-campos.controller';
import { KanbanCamposService } from './kanban-campos.service';
import { KanbanCardsController } from './kanban-cards.controller';
import { KanbanCardsService } from './kanban-cards.service';
import { KanbanChecklistsController } from './kanban-checklists.controller';
import { KanbanChecklistsService } from './kanban-checklists.service';
import { KanbanComentariosController } from './kanban-comentarios.controller';
import { KanbanComentariosService } from './kanban-comentarios.service';
import { KanbanEtiquetasController } from './kanban-etiquetas.controller';
import { KanbanEtiquetasService } from './kanban-etiquetas.service';
import { KanbanListasController } from './kanban-listas.controller';
import { KanbanListasService } from './kanban-listas.service';
import { KanbanTokensController } from './kanban-tokens.controller';
import { KanbanTokensService } from './kanban-tokens.service';

/**
 * Kanban estilo Trello (docs/kanban-betinna-EM-BATCHES.md).
 * Módulo de permissão: 'quadros' ('kanban' é o pipeline de leads).
 */
@Module({
  controllers: [
    KanbanBoardsController,
    KanbanListasController,
    KanbanCardsController,
    KanbanEtiquetasController,
    KanbanChecklistsController,
    KanbanCamposController,
    KanbanComentariosController,
    KanbanTokensController,
  ],
  providers: [
    KanbanAcessoService,
    KanbanAtividadeService,
    KanbanBoardsService,
    KanbanListasService,
    KanbanCardsService,
    KanbanEtiquetasService,
    KanbanChecklistsService,
    KanbanCamposService,
    KanbanComentariosService,
    KanbanAnexosService,
    KanbanTokensService,
  ],
  exports: [KanbanAcessoService, KanbanAtividadeService],
})
export class KanbanModule {}
