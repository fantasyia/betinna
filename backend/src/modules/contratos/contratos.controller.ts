import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type ListContratosDto, listContratosSchema } from './contratos.dto';
import { ContratosService } from './contratos.service';
import { ContratoMensalidadeSyncService } from './contrato-mensalidade-sync.service';

/**
 * Contratos de locação — leitura.
 *
 * Não há POST nem PATCH de escrita de propósito: contrato não se cria nem se
 * edita à mão (a varredura de mensalidades abaixo não altera o contrato — ela
 * só lê o ERP e libera comissão).
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
  constructor(
    private readonly contratos: ContratosService,
    private readonly mensalidades: ContratoMensalidadeSyncService,
  ) {}

  /**
   * Lê no ERP quais mensalidades de locação foram pagas e libera a comissão do
   * mês. A rodada diária faz isto sozinha; o endpoint existe pra conferir na
   * hora, logo depois de o financeiro baixar uma cobrança.
   *
   * Vive aqui, e não em /comissoes, porque o serviço é do módulo de contratos —
   * pendurá-lo lá criava ciclo entre os dois módulos.
   */
  @Post('sincronizar-mensalidades')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'sincronizar_mensalidades', resource: 'contrato' })
  @ApiOperation({ summary: 'Varre as cobranças de contrato pagas no ERP e libera as comissões.' })
  sincronizarMensalidades(@CurrentUser() user: AuthenticatedUser) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.mensalidades.varrer(user.empresaIdAtiva);
  }

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
