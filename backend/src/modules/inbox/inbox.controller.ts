import {
  Body,
  Controller,
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
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type AlterarStatusDto,
  type AtribuirDto,
  type ListConversationsDto,
  type ListMensagensDto,
  type ResponderDto,
  alterarStatusSchema,
  atribuirSchema,
  listConversationsSchema,
  listMensagensSchema,
  responderSchema,
} from './inbox.dto';
import { InboxService } from './inbox.service';

/**
 * Inbox unificada (atendimento ao cliente).
 *
 * Visibilidade por papel:
 *  - ADMIN/DIRECTOR/GERENTE/SAC: todas as conversas da empresa (todos os canais
 *    — WhatsApp, IG, FB, ML, Shopee, Amazon, TikTok, Email)
 *  - REP: APENAS conversas WhatsApp com clientes da carteira dele (ou
 *    conversas atribuídas a ele). Marketplaces/redes sociais são responsabili-
 *    dade da equipe interna SAC.
 *
 * Permissões granulares específicas da role SAC ficam configuráveis pelo Admin
 * em /permissions (matriz Role × Módulo × Ação).
 */
@ApiTags('inbox')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'SAC', 'REP')
@Controller('inbox')
export class InboxController {
  constructor(private readonly svc: InboxService) {}

  @Get('canais')
  @ApiOperation({ summary: 'Lista canais com adapter registrado/disponível' })
  canais() {
    return { canais: this.svc.canaisDisponiveis() };
  }

  @Get()
  @ApiOperation({
    summary: 'Lista conversations (filtros: canal, status, atribuído, cliente, search, meu)',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listConversationsSchema)) query: ListConversationsDto,
  ) {
    return this.svc.list(user, query);
  }

  @Get(':id')
  findById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.findById(user, id);
  }

  @Get(':id/mensagens')
  @ApiOperation({ summary: 'Lista mensagens da conversa (paginação cursor via antesDe)' })
  listMensagens(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listMensagensSchema)) query: ListMensagensDto,
  ) {
    return this.svc.listMensagens(user, id, query);
  }

  @Post(':id/responder')
  @Audit({ action: 'responder', resource: 'conversation', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Envia mensagem de resposta pelo canal da conversa' })
  responder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(responderSchema)) dto: ResponderDto,
  ) {
    return this.svc.responder(user, id, dto);
  }

  @Patch(':id/atribuir')
  @Audit({ action: 'atribuir', resource: 'conversation', resourceIdFrom: 'params.id' })
  atribuir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(atribuirSchema)) dto: AtribuirDto,
  ) {
    return this.svc.atribuir(user, id, dto);
  }

  @Patch(':id/status')
  @Audit({ action: 'alterar_status', resource: 'conversation', resourceIdFrom: 'params.id' })
  alterarStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(alterarStatusSchema)) dto: AlterarStatusDto,
  ) {
    return this.svc.alterarStatus(user, id, dto);
  }

  @Post(':id/marcar-lida')
  @HttpCode(HttpStatus.OK)
  marcarComoLida(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.marcarComoLida(user, id);
  }
}
