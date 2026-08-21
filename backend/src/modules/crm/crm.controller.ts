import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CrmService } from './crm.service';
import {
  type ContatoEtapaDto,
  type ContatoExcluirDto,
  type ContatoRepresentanteDto,
  type ContatoTagsDto,
  contatoEtapaSchema,
  contatoExcluirSchema,
  contatoRepresentanteSchema,
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

  @Post('contato/representante')
  @RequirePermissions({ module: 'kanban', action: 'edit' })
  @ApiOperation({
    summary:
      'Atribui (ou desatribui, com null) o representante de um lead. Mesmas validações da UI.',
  })
  @Audit({ action: 'atribuir_rep', resource: 'lead', resourceIdFrom: 'body.leadId' })
  atribuirRepresentante(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(contatoRepresentanteSchema)) dto: ContatoRepresentanteDto,
  ) {
    return this.crm.atribuirRepresentante(user, dto);
  }

  /**
   * Exclusão de lead por lista explícita de ids. POST (não DELETE) porque o
   * corpo é obrigatório: a confirmação de contagem viaja nele, e DELETE com
   * body é mal suportado por proxy/cliente.
   *
   * `@Roles` de gestão pelo mesmo motivo do `DELETE /leads/:id`: o gate granular
   * colapsa edit→delete e um REP acabaria com poder de apagar lead.
   */
  @Post('contato/excluir')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @RequirePermissions({ module: 'kanban', action: 'delete' })
  @ApiOperation({
    summary: 'Exclui leads por lista explícita de ids (recusa lead sem funil). Irreversível.',
  })
  @Audit({ action: 'excluir_lote', resource: 'lead' })
  excluir(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(contatoExcluirSchema)) dto: ContatoExcluirDto,
  ) {
    return this.crm.excluirLeads(user, dto);
  }
}
