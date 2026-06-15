import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ContatosService } from './contatos.service';
import {
  type AcaoMassaDto,
  type ListContatosDto,
  acaoMassaSchema,
  listContatosSchema,
} from './contatos.dto';

@ApiTags('contatos')
@ApiBearerAuth()
@Controller('contatos')
export class ContatosController {
  constructor(private readonly contatos: ContatosService) {}

  @Get()
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({
    summary:
      'Visão unificada de contatos — Lead + Cliente + Conversa do Inbox, ' +
      'deduplicados por telefone (D18), com o(s) tipo(s) de cada um. Paginado + busca + filtros.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listContatosSchema)) query: ListContatosDto,
  ) {
    return this.contatos.list(user, query);
  }

  @Post('acao-massa')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'acao_massa', resource: 'contato' })
  @ApiOperation({
    summary:
      'Ação em lote sobre contatos selecionados: aplicar/remover tag, excluir, ' +
      'ou mover de etapa no funil (essa só afeta os que são Lead).',
  })
  acaoMassa(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(acaoMassaSchema)) dto: AcaoMassaDto,
  ) {
    return this.contatos.acaoMassa(user, dto);
  }
}
