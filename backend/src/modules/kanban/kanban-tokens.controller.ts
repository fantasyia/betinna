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
import { KanbanTokensService } from './kanban-tokens.service';
import {
  type CreateApiTokenDto,
  type UpdateApiTokenDto,
  createApiTokenSchema,
  updateApiTokenSchema,
} from './kanban.dto';

/**
 * Tokens de API do Kanban (pro MCP server). O AuthGuard bloqueia acesso a
 * estas rotas via token de API (só sessão JWT cria/gerencia tokens).
 */
@ApiTags('kanban')
@ApiBearerAuth()
@Controller('kanban/api-tokens')
export class KanbanTokensController {
  constructor(private readonly tokens: KanbanTokensService) {}

  @Post()
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Gera token de API — o valor aparece UMA única vez' })
  @Audit({ action: 'create', resource: 'kanban_api_token', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createApiTokenSchema)) dto: CreateApiTokenDto,
  ) {
    return this.tokens.create(user, dto);
  }

  @Get()
  @RequirePermissions({ module: 'quadros', action: 'view' })
  @ApiOperation({ summary: 'Lista meus tokens (sem o valor)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tokens.list(user);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @ApiOperation({ summary: 'Ajusta o ESCOPO do token (sem trocar o valor)' })
  @Audit({ action: 'update', resource: 'kanban_api_token', resourceIdFrom: 'params.id' })
  atualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateApiTokenSchema)) dto: UpdateApiTokenDto,
  ) {
    return this.tokens.atualizarEscopo(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o token (passa a responder 401)' })
  @Audit({ action: 'revoke', resource: 'kanban_api_token', resourceIdFrom: 'params.id' })
  async revogar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.tokens.revogar(user, id);
  }
}
