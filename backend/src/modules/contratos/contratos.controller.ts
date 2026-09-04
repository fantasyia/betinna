import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type ListContratosDto, listContratosSchema } from './contratos.dto';
import { ContratosService } from './contratos.service';

/**
 * Contratos de locação — leitura.
 *
 * Não há POST nem PATCH de propósito: contrato não se cria nem se edita à mão.
 * Ele nasce do aceite da proposta e muda de estado pelo que acontece fora do
 * app (assinatura eletrônica, liberação no ERP). Endpoint de escrita aqui seria
 * um jeito de o app discordar do documento que o cliente assinou.
 *
 * Permissão de `propostas`: o contrato é o desfecho da proposta, e quem enxerga
 * uma tem que enxergar o outro — módulo novo na matriz só criaria uma porta a
 * mais pra esquecer de abrir.
 */
@ApiTags('contratos')
@ApiBearerAuth()
@Controller('contratos')
export class ContratosController {
  constructor(private readonly contratos: ContratosService) {}

  @Get()
  @RequirePermissions({ module: 'propostas', action: 'view' })
  @ApiOperation({ summary: 'Lista os contratos (rep vê os da carteira dele).' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listContratosSchema)) query: ListContratosDto,
  ) {
    return this.contratos.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'propostas', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contratos.findById(user, id);
  }

  @Get(':id/pdf')
  @RequirePermissions({ module: 'propostas', action: 'view' })
  @ApiOperation({
    summary: 'Link temporário (1h) pro PDF assinado — o bucket é privado.',
  })
  pdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contratos.pdf(user, id);
  }
}
