import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CriarThreadDto,
  type ListThreadsDto,
  type ResponderThreadDto,
  criarThreadSchema,
  listThreadsSchema,
  responderThreadSchema,
} from './inbox-interna.dto';
import { InboxInternaService } from './inbox-interna.service';

@ApiTags('inbox-interna')
@ApiBearerAuth()
@Controller('inbox-interna')
export class InboxInternaController {
  constructor(private readonly inbox: InboxInternaService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listThreadsSchema)) query: ListThreadsDto,
  ) {
    return this.inbox.list(user, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inbox.findById(user, id);
  }

  @Post()
  @Audit({ action: 'criar', resource: 'inbox_interna', resourceIdFrom: 'response.id' })
  @ApiOperation({ summary: 'Abre uma conversa interna (rep ↔ empresa)' })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(criarThreadSchema)) dto: CriarThreadDto,
  ) {
    return this.inbox.criar(user, dto);
  }

  @Post(':id/responder')
  @Audit({ action: 'responder', resource: 'inbox_interna', resourceIdFrom: 'params.id' })
  responder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(responderThreadSchema)) dto: ResponderThreadDto,
  ) {
    return this.inbox.responder(user, id, dto);
  }

  @Post(':id/resolver')
  @Audit({ action: 'resolver', resource: 'inbox_interna', resourceIdFrom: 'params.id' })
  resolver(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inbox.resolver(user, id);
  }
}
