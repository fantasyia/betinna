import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type FecharMesDto,
  type ListComissoesDto,
  type MarcarPagoDto,
  fecharMesSchema,
  listComissoesSchema,
  marcarPagoSchema,
} from './comissoes.dto';
import { ComissoesService } from './comissoes.service';
import { ComissaoErpService } from './comissao-erp.service';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

@ApiTags('comissoes')
@ApiBearerAuth()
@Controller('comissoes')
export class ComissoesController {
  constructor(
    private readonly comissoes: ComissoesService,
    private readonly erp: ComissaoErpService,
  ) {}

  @Get('meu-resumo')
  @RequirePermissions({ module: 'comissoes', action: 'view' })
  @ApiOperation({ summary: 'Resumo de comissões do rep autenticado' })
  meuResumo(@CurrentUser() user: AuthenticatedUser) {
    return this.comissoes.resumoDoRep(user);
  }

  @Get()
  @RequirePermissions({ module: 'comissoes', action: 'view' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listComissoesSchema)) query: ListComissoesDto,
  ) {
    return this.comissoes.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'comissoes', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.comissoes.findById(user, id);
  }

  /**
   * Reprovisiona a folha no financeiro do ERP.
   *
   * O fechamento já provisiona sozinho; isto existe pro caso em que o ERP
   * estava fora do ar (ou o rep ainda não tinha contato lá) e a folha ficou
   * fechada sem as contas a pagar. É idempotente: quem já tem conta criada não
   * é lançado de novo.
   */
  @Post('provisionar-erp')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'provisionar_erp', resource: 'comissao' })
  @ApiOperation({ summary: 'Cria no ERP as contas a pagar da folha do mês (idempotente).' })
  provisionarErp(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(fecharMesSchema)) dto: FecharMesDto,
  ) {
    const empresaId = user.empresaIdAtiva;
    if (!empresaId) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.erp.provisionar(empresaId, dto.mes, dto.ano);
  }

  @Post('fechar-mes')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'fechar_mes', resource: 'comissao' })
  @ApiOperation({
    summary:
      'Fecha o mês: agrega pedidos comissionáveis (ENVIADO_ERP+) e cria/atualiza registros. ' +
      '**DIRETOR-only (D46)** — determina valores a pagar aos reps.',
  })
  fecharMes(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(fecharMesSchema)) dto: FecharMesDto,
  ) {
    return this.comissoes.fecharMes(user, dto);
  }

  @Put(':id/pagar')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'marcar_pago', resource: 'comissao', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Marca comissão como paga. **DIRETOR-only (D46)** — libera registro financeiro.',
  })
  marcarPago(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(marcarPagoSchema)) dto: MarcarPagoDto,
  ) {
    return this.comissoes.marcarPago(user, id, dto);
  }

  @Put(':id/desmarcar-pago')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'desmarcar_pago', resource: 'comissao', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Reverte pagamento de comissão. **DIRETOR-only (D46)** — operação sensível, gera audit.',
  })
  desmarcarPago(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.comissoes.desmarcarPago(user, id);
  }
}
