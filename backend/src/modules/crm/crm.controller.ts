import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CrmService } from './crm.service';
import {
  type ContatoEtapaDto,
  type ContatoTagsDto,
  contatoEtapaSchema,
  contatoTagsSchema,
} from './crm.dto';

/**
 * Ações de CRM por MCP (Claude Code) — ESCRITA sob escopo de token `crm`.
 * Cada rota opera sobre UM contato (por leadId/clienteId/telefone).
 */
@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Post('contato/tags')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @ApiOperation({ summary: 'Adiciona/remove tags (por nome) de um contato. Tags disparam fluxos.' })
  @Audit({ action: 'tags', resource: 'contato' })
  tags(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(contatoTagsSchema)) dto: ContatoTagsDto,
  ) {
    return this.crm.tags(user, dto);
  }

  @Post('contato/etapa')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @ApiOperation({
    summary: 'Move um lead de etapa no funil (retorna de→para). Dispara LEAD_ETAPA_MUDOU.',
  })
  @Audit({ action: 'mover_etapa', resource: 'lead', resourceIdFrom: 'body.leadId' })
  moverEtapa(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(contatoEtapaSchema)) dto: ContatoEtapaDto,
  ) {
    return this.crm.moverEtapa(user, dto);
  }
}
