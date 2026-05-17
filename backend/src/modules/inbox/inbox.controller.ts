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
  type BulkAlterarStatusDto,
  type BulkAtribuirDto,
  type BulkIdsDto,
  type ListConversationsDto,
  type ListMensagensDto,
  type ResponderDto,
  type ResponderMidiaDto,
  alterarStatusSchema,
  atribuirSchema,
  bulkAlterarStatusSchema,
  bulkAtribuirSchema,
  bulkIdsSchema,
  listConversationsSchema,
  listMensagensSchema,
  responderMidiaSchema,
  responderSchema,
} from './inbox.dto';
import { InboxService } from './inbox.service';
import { WhatsAppMediaService } from '@integrations/whatsapp/whatsapp-media.service';
import { WhatsAppService } from '@integrations/whatsapp/whatsapp.service';
import { MetaMediaService } from '@integrations/meta/meta-media.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';

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
  constructor(
    private readonly svc: InboxService,
    private readonly whatsappMedia: WhatsAppMediaService,
    private readonly whatsapp: WhatsAppService,
    private readonly metaMedia: MetaMediaService,
  ) {}

  @Get('messages/:id/media')
  @ApiOperation({
    summary: 'Retorna signed URL temporária para mídia da mensagem (válida ~7 dias)',
  })
  async getMessageMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ url: string; mime: string | null }> {
    const info = await this.svc.getMessageMediaPath(user, id);
    if (!info) {
      throw new NotFoundException('Message media', id);
    }

    // mediaUrl pode ser:
    //  - storage path (foi arquivado por Whats/Meta media service)
    //  - URL pública (fallback quando arquivamento falhou — usado direto)
    // Heurística simples: se começa com http, retorna direto. Senão, gera signed URL.
    if (info.storagePath.startsWith('http://') || info.storagePath.startsWith('https://')) {
      return { url: info.storagePath, mime: info.mime };
    }

    let url: string | null = null;
    if (info.canal === 'WHATSAPP') {
      url = await this.whatsappMedia.signedUrl(info.storagePath);
    } else if (info.canal === 'FACEBOOK' || info.canal === 'INSTAGRAM') {
      url = await this.metaMedia.signedUrl(info.storagePath);
    } else {
      throw new BusinessRuleException(
        `Mídia do canal ${info.canal} ainda não está disponível para download`,
      );
    }
    if (!url) {
      throw new BusinessRuleException('Falha gerando URL temporária');
    }
    return { url, mime: info.mime };
  }

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

  @Post(':id/responder-midia')
  @Audit({ action: 'responder_midia', resource: 'conversation', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Envia mídia (imagem/vídeo/áudio/documento). storagePath OU url obrigatório. Hoje suporta WhatsApp.',
  })
  responderComMidia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(responderMidiaSchema)) dto: ResponderMidiaDto,
  ) {
    return this.svc.responderComMidia(user, id, dto, this.whatsapp);
  }

  // ─── Bulk operations ─────────────────────────────────────────────────

  @Post('bulk/atribuir')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'bulk_atribuir', resource: 'conversation' })
  @ApiOperation({ summary: 'Atribui em lote (max 200 ids). REP bloqueado.' })
  bulkAtribuir(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(bulkAtribuirSchema)) dto: BulkAtribuirDto,
  ) {
    return this.svc.bulkAtribuir(user, dto.ids, dto.atribuidoId);
  }

  @Post('bulk/status')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'bulk_status', resource: 'conversation' })
  @ApiOperation({ summary: 'Altera status (RESOLVIDA/ARQUIVADA/etc) em lote.' })
  bulkAlterarStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(bulkAlterarStatusSchema)) dto: BulkAlterarStatusDto,
  ) {
    return this.svc.bulkAlterarStatus(user, dto.ids, dto.status);
  }

  @Post('bulk/arquivar')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'bulk_arquivar', resource: 'conversation' })
  @ApiOperation({ summary: 'Atalho: arquivar conversations em lote' })
  bulkArquivar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(bulkIdsSchema)) dto: BulkIdsDto,
  ) {
    return this.svc.bulkArquivar(user, dto.ids);
  }

  @Post('bulk/marcar-lidas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marca todas mensagens INBOUND como READ em lote' })
  bulkMarcarLidas(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(bulkIdsSchema)) dto: BulkIdsDto,
  ) {
    return this.svc.bulkMarcarLidas(user, dto.ids);
  }
}
