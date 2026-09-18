import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type ListContratosDto,
  type ReenviarContratoDto,
  listContratosSchema,
  reenviarContratoSchema,
} from './contratos.dto';
import { ContratosService } from './contratos.service';
import { ContratoAprovacaoJob } from './contrato-aprovacao.job';
import { ContratoErpService } from './contrato-erp.service';
import { ContratoComodatoErpService } from './contrato-comodato-erp.service';
import { FiscalPendenciasService } from './fiscal-pendencias.service';
import { ContratoMensalidadeSyncService } from './contrato-mensalidade-sync.service';
import { ContratoReenvioService } from './contrato-reenvio.service';

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
    private readonly fiscal: FiscalPendenciasService,
    private readonly comodatoErp: ContratoComodatoErpService,
    private readonly reenvio: ContratoReenvioService,
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

  /**
   * O que falta pra emitir — perguntável ANTES de tentar.
   *
   * ⚠️ Vem ANTES de `@Get(':id')` de propósito: rota fixa depois de rota com
   * parâmetro vira id. "fiscal" seria lido como id de contrato e daria 404.
   */
  /**
   * Emite a NF de COMODATO do contrato — a remessa do equipamento.
   *
   * 🔴 Manual por decisão do Léo (12/09), e o motivo é o custo do erro: nota
   * fiscal não tem desfazer pela API do Tiny (sem segunda nota pro mesmo
   * pedido, sem endpoint de alterar, rejeitada guarda snapshot do item). Um
   * humano no gatilho é a última rede antes de o documento existir no mundo.
   *
   * Sai SEMPRE do pedido de venda — nunca avulsa.
   */
  @Post(':id/emitir-comodato')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'emitir_comodato', resource: 'contrato', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Emite a NF de comodato a partir do pedido de venda. **DIRETOR/ADMIN**.',
  })
  emitirComodato(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.comodatoErp.emitir(id, user.empresaIdAtiva);
  }

  /**
   * Liga a emissão de nota do contrato no ERP depois que a contabilidade
   * preencheu os dados fiscais. Sem isto, contrato que subiu antes da definição
   * fica cobrando sem emitir NFS-e até alguém ligar no painel, um por um.
   */
  @Post(':id/sincronizar-fiscal')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'sincronizar_fiscal', resource: 'contrato', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Atualiza no ERP a emissão de nota do contrato. **DIRETOR/ADMIN**.' })
  sincronizarFiscal(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.erp.sincronizarFiscal(id, user.empresaIdAtiva);
  }

  @Get('fiscal/pendencias')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({
    summary:
      'Dados fiscais que faltam pra emitir NFS-e mensal e NF de comodato. **DIRETOR/ADMIN**.',
  })
  pendenciasFiscais(@CurrentUser() user: AuthenticatedUser) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.fiscal.verificar(user.empresaIdAtiva);
  }

  /**
   * O cliente pediu alteração de cláusula, o diretor alinhou, e agora vai a
   * versão nova pra assinar.
   *
   * **Quem manda é o DIRETOR.** O rep avisa por fora — é combinado que seja
   * manual — e não dispara: mudar cláusula é decisão contratual, mesma classe
   * de teto de desconto e % de comissão (D46). ADMIN entra junto como override
   * de suporte da plataforma (D48), não como operação normal.
   *
   * 🔴 O envelope ANTERIOR é expirado na ClickSign antes de o novo sair. Sem
   * isso o cliente ficaria com dois links válidos e poderia assinar justamente
   * a versão que pediu pra mudar.
   */
  @Post(':id/reenviar-assinatura')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'reenviar_assinatura', resource: 'contrato', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Reenvia o contrato pra assinatura com a cláusula alterada. **DIRETOR/ADMIN**.',
  })
  reenviarAssinatura(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reenviarContratoSchema)) body: ReenviarContratoDto,
  ) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.reenvio.reenviar({
      empresaId: user.empresaIdAtiva,
      contratoId: id,
      usuarioId: user.id,
      motivo: body.motivo,
    });
  }

  /**
   * As rodadas de assinatura deste contrato — mais recente primeiro.
   *
   * Leitura pra quem já vê a proposta: o rep precisa saber em que versão o
   * cliente está, senão cobra assinatura de um link que foi expirado.
   */
  @Get(':id/envios-assinatura')
  @RequirePermissions({ module: 'propostas', action: 'view' })
  @ApiOperation({ summary: 'Histórico dos envios pra assinatura (o link de cada rodada).' })
  enviosAssinatura(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.reenvio.historico(user.empresaIdAtiva, id);
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
