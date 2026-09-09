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
import { ContratoAprovacaoJob } from './contrato-aprovacao.job';
import { ContratoErpService } from './contrato-erp.service';
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
    private readonly erp: ContratoErpService,
    private readonly aprovacao: ContratoAprovacaoJob,
  ) {}

  /**
   * Confere no ERP quais orçamentos já foram aprovados e cria o contrato
   * recorrente dos que passaram. A varredura de 30 em 30min faz isto sozinha —
   * o endpoint é pra conferir na hora, logo depois de aprovar.
   *
   * Existe porque o Tiny NÃO tem webhook de orçamento (os eventos são de
   * pedido, nota e estoque): sem perguntar, o app nunca fica sabendo.
   */
  @Post('verificar-aprovacoes')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'verificar_aprovacoes', resource: 'contrato' })
  @ApiOperation({ summary: 'Vê quais orçamentos foram aprovados no ERP e cria os contratos.' })
  verificarAprovacoes(@CurrentUser() user: AuthenticatedUser) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.aprovacao.varrer(user.empresaIdAtiva);
  }

  /**
   * Sobe o contrato assinado pro ERP como contrato recorrente.
   *
   * É POST porque cria coisa do outro lado, mas não é escrita no contrato do
   * app: o documento continua sendo o que o cliente assinou. Fica restrito a
   * ADMIN/DIRECTOR porque, uma vez lá, a cobrança mensal começa e a v2 do Tiny
   * não tem como excluir — só encerrar.
   */
  @Post(':id/enviar-erp')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'enviar_erp', resource: 'contrato', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Cria o contrato recorrente no ERP (só depois de assinado).' })
  enviarErp(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.erp.enviar(id, user.empresaIdAtiva);
  }

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

  /**
   * Refaz o cronograma de comissão do contrato pela regra ATUAL do tenant.
   *
   * Existe porque faltava a ponte entre "mudar a regra" e "aplicar a regra": a
   * regra de locação vive em `Empresa.config.comissoes.locacao` e muda sem
   * deploy, mas contrato existente só recalculava quando a NF de comodato
   * chegava — um caminho que acontece UMA vez na vida do contrato. Trocar uma
   * porcentagem e nada mudar é pior que não poder trocar: parece que aplicou.
   *
   * Seguro de repetir: o recálculo é idempotente e **não reescreve mês que já
   * virou conta a pagar no ERP** — linha que perdeu o direito vira ZERO com o id
   * da conta, que é o sinal pra alguém apagar lá (a API do Tiny não apaga).
   *
   * DIRECTOR/ADMIN por D46: mexer em comissão é decisão financeira.
   */
  @Post(':id/recalcular-comissoes')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'recalcular_comissoes', resource: 'contrato', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Refaz as comissões do contrato pela regra atual do tenant.' })
  recalcularComissoes(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.contratos.recalcularComissoes(user.empresaIdAtiva, id);
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
