import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ContatosService } from './contatos.service';
import { type ListContatosDto, listContatosSchema } from './contatos.dto';

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
}
