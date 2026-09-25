import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type ChangeStatusDto,
  type CreatePropostaDto,
  type ListPropostasDto,
  type PropostaItemInputDto,
  type SelecaoModeloDto,
  type UpdatePropostaDto,
  changeStatusSchema,
  createPropostaSchema,
  listPropostasSchema,
  propostaItemInputSchema,
  selecaoModeloSchema,
  updatePropostaSchema,
} from './propostas.dto';
import { PropostaAceiteService } from './proposta-aceite.service';
import { PropostasService } from './propostas.service';
import { PropostaErpService } from './proposta-erp.service';
import { PropostaAnexosService } from './proposta-anexos.service';

const decidirAceiteSchema = z.object({
  decisao: z.enum(['ACEITA', 'RECUSADA']),
});

@ApiTags('propostas')
@ApiBearerAuth()
@Controller('propostas')
export class PropostasController {
  constructor(
    private readonly propostas: PropostasService,
    private readonly aceite: PropostaAceiteService,
    private readonly erp: PropostaErpService,
    private readonly anexos: PropostaAnexosService,
  ) {}

  // ─── C3 — Aceite externo (PÚBLICO, sem login) ───────────────────────────
  // Declarados PRIMEIRO pra `aceite/:token` não colidir com `:id`.

  @Public()
  @Get('aceite/:token')
  @Throttle({ default: { limit: 30, ttl: seconds(60) } })
  @ApiOperation({ summary: 'Preview público da proposta via token de aceite (sem login).' })
  aceitePreview(@Param('token') token: string) {
    return this.aceite.resolverPreview(token);
  }

  @Public()
  @Get('aceite/:token/anexos/:anexoId')
  @Throttle({ default: { limit: 30, ttl: seconds(60) } })
  @ApiOperation({ summary: 'Link temporário do PROJETO anexado, pro cliente na página de aceite.' })
  async aceiteAnexo(@Param('token') token: string, @Param('anexoId') anexoId: string) {
    const propostaId = await this.aceite.propostaDoTokenAberto(token);
    return this.anexos.linkAssinado(propostaId, anexoId);
  }

  @Public()
  @Post('aceite/:token/decidir')
  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  @ApiOperation({ summary: 'Cliente aceita/recusa a proposta. Aceite gera pedido automático.' })
  aceiteDecidir(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(decidirAceiteSchema)) dto: { decisao: 'ACEITA' | 'RECUSADA' },
    @Ip() ip: string,
  ) {
    return this.aceite.registrarDecisao(token, dto.decisao, ip);
  }

  @Get()
  @RequirePermissions({ module: 'propostas', action: 'view' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listPropostasSchema)) query: ListPropostasDto,
  ) {
    return this.propostas.list(user, query);
  }

  /**
   * LEVANTAMENTO DE CAMPO: qual Master Block atende esta corrente.
   *
   * O rep está no cliente, mede o quadro e digita a corrente; a tela mostra o
   * modelo na hora. Fica antes de `@Get(':id')` porque rota fixa depois de rota
   * com parâmetro é lida como id.
   *
   * ⛔ NÃO chuta. Corrente fora de toda faixa volta `ok: false` com o motivo, e
   * a tela mostra o motivo em vez de um modelo. Devolver "o maior que eu tenho"
   * seria vender equipamento que não protege a instalação — e o prejuízo só
   * aparece quando queima.
   */
  @Get('selecao-modelo')
  @RequirePermissions({ module: 'propostas', action: 'create' })
  @ApiOperation({ summary: 'O Master Block para a corrente medida no quadro.' })
  selecaoModelo(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(selecaoModeloSchema)) query: SelecaoModeloDto,
  ) {
    return this.propostas.selecionarModelo(user, query.correnteA, query.variante);
  }

  // ─── C2 — Exportação (declaradas antes de @Get(':id') por especificidade) ──

  @Get(':id/pdf')
  @RequirePermissions({ module: 'propostas', action: 'view' })
  @Audit({ action: 'exportar_pdf', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Gera PDF da proposta (retorna { filename, base64 }).' })
  exportarPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.exportarPdf(user, id);
  }

  @Get(':id/excel')
  @RequirePermissions({ module: 'propostas', action: 'view' })
  @Audit({ action: 'exportar_excel', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Gera Excel da proposta (retorna { filename, base64 }).' })
  exportarExcel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.exportarExcel(user, id);
  }

  @Post(':id/enviar-email')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @Audit({ action: 'enviar_email', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Envia a proposta (PDF anexo) por email pro cliente via Resend.' })
  enviarEmail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.enviarPorEmail(user, id);
  }

  @Post(':id/enviar-aceite')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @Audit({ action: 'enviar_aceite', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'C3 — Gera link público de aceite pra enviar ao cliente. Status vira AGUARDANDO_ASSINATURA.',
  })
  enviarAceite(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.enviarParaAceite(user, id);
  }

  @Get(':id')
  @RequirePermissions({ module: 'propostas', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.findById(user, id);
  }

  @Post()
  @RequirePermissions({ module: 'propostas', action: 'create' })
  @Audit({ action: 'create', resource: 'proposta', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPropostaSchema)) dto: CreatePropostaDto,
  ) {
    return this.propostas.create(user, dto);
  }

  /**
   * Acrescenta um quadro ao levantamento salvo.
   *
   * 🔴 E o que faz o levantamento poder ser RETOMADO: o representante mede em
   * campo, salva, e volta depois sem redigitar. So em RASCUNHO.
   */
  @Post(':id/itens')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @Audit({ action: 'add_item', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Adiciona um item/quadro a uma proposta em RASCUNHO.' })
  adicionarItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(propostaItemInputSchema)) dto: PropostaItemInputDto,
  ) {
    return this.propostas.adicionarItem(user, id, dto);
  }

  @Delete(':id/itens/:itemId')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @Audit({ action: 'remove_item', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Remove um item/quadro de uma proposta em RASCUNHO.' })
  removerItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.propostas.removerItem(user, id, itemId);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @Audit({ action: 'update', resource: 'proposta', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePropostaSchema)) dto: UpdatePropostaDto,
  ) {
    return this.propostas.update(user, id, dto);
  }

  @Put(':id/status')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @Audit({ action: 'change_status', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Muda status seguindo máquina de estados (RASCUNHO → ENVIADA → ... → ACEITA/RECUSADA)',
  })
  changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeStatusSchema)) dto: ChangeStatusDto,
  ) {
    return this.propostas.changeStatus(user, id, dto);
  }

  @Post(':id/enviar-erp')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @Audit({ action: 'enviar_erp', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Sobe a proposta como ORÇAMENTO no ERP. Lá ela vira pedido com um clique, ' +
      'sem redigitação — o pedido herda o que o cliente aprovou.',
  })
  enviarErp(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.erp.enviar(id, user.empresaIdAtiva!);
  }

  @Post(':id/gerar-pedido-erp')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'gerar_pedido_erp', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Transforma o orçamento APROVADO em pedido de venda no ERP. Exige proposta ACEITA ' +
      'e recusa a segunda chamada — o ERP geraria um pedido duplicado sem reclamar.',
  })
  gerarPedidoErp(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.erp.gerarPedido(id, user.empresaIdAtiva!);
  }

  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR')
  @RequirePermissions({ module: 'propostas', action: 'delete' })
  @Audit({ action: 'delete', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Apaga a proposta. Recusa proposta ACEITA ou já convertida em pedido — isso é histórico de venda.',
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.remove(user, id);
  }

  @Post(':id/converter-em-pedido')
  @RequirePermissions({ module: 'pedidos', action: 'create' })
  @Audit({ action: 'converter_pedido', resource: 'proposta', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Cria Pedido com base na proposta ACEITA' })
  converter(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propostas.converterEmPedido(user, id);
  }
}
