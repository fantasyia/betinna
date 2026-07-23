import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ContatosService } from './contatos.service';
import { ContatosMesclagemService } from './contatos-mesclagem.service';
import {
  type AcaoMassaDto,
  type CriarLeadsDto,
  type DetalheContatoDto,
  type DuplicatasQueryDto,
  type ListContatosDto,
  type MesclarClientesDto,
  type MesclarLeadsDto,
  type VincularLeadClienteDto,
  acaoMassaSchema,
  duplicatasQuerySchema,
  mesclarClientesSchema,
  mesclarLeadsSchema,
  vincularLeadClienteSchema,
  criarLeadsSchema,
  detalheContatoSchema,
  listContatosSchema,
} from './contatos.dto';

@ApiTags('contatos')
@ApiBearerAuth()
@Controller('contatos')
export class ContatosController {
  constructor(
    private readonly contatos: ContatosService,
    private readonly mesclagem: ContatosMesclagemService,
  ) {}

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

  @Get('detalhe')
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({
    summary:
      'Detalhe de UM contato (Lead+Cliente+Conversa unificados) por leadId, clienteId, ' +
      'telefone ou email — com tipos, tags, etapa atual no funil e representante. Dados pessoais.',
  })
  detalhe(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(detalheContatoSchema)) query: DetalheContatoDto,
  ) {
    return this.contatos.detalhe(user, query);
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

  @Post('criar-leads')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'criar_leads', resource: 'contato' })
  @ApiOperation({
    summary:
      'Adiciona contatos selecionados a um funil, criando um Lead pra cada um ' +
      '(pula quem já tem lead com o mesmo telefone).',
  })
  criarLeads(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(criarLeadsSchema)) dto: CriarLeadsDto,
  ) {
    return this.contatos.criarLeads(user, dto);
  }

  // ─── Mesclagem de duplicatas ────────────────────────────────────────
  // ⚠️ Rotas LITERAIS antes de qualquer ':id' (senão o param engole a rota).

  @Get('duplicatas')
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({
    summary:
      'Grupos de leads suspeitos de serem a mesma pessoa (sufixo de telefone ou ' +
      'e-mail). SÓ LISTA — duplicata é decisão humana, nada é mesclado sozinho.',
  })
  duplicatas(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(duplicatasQuerySchema)) q: DuplicatasQueryDto,
  ) {
    return this.mesclagem.duplicatas(user, q.limite);
  }

  @Post('mesclar/previa')
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({
    summary:
      'Prévia da mesclagem: o que sobrevive, qual atribuição fica (a do MAIS ANTIGO) ' +
      'e quantos vínculos migram. Não altera nada.',
  })
  previaMesclagem(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(mesclarLeadsSchema)) dto: MesclarLeadsDto,
  ) {
    return this.mesclagem.previa(user, dto.principalId, dto.absorvidoId);
  }

  @Post('mesclar')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'mesclar_leads', resource: 'contato' })
  @ApiOperation({
    summary:
      'Funde dois leads duplicados: o principal sobrevive, o outro é absorvido. ' +
      'A atribuição de campanha vem do registro MAIS ANTIGO. Reversível.',
  })
  mesclar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(mesclarLeadsSchema)) dto: MesclarLeadsDto,
  ) {
    return this.mesclagem.mesclarLeads(user, dto.principalId, dto.absorvidoId);
  }

  @Post('vincular-cliente')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'vincular_lead_cliente', resource: 'contato' })
  @ApiOperation({
    summary:
      'Liga um Lead a um Cliente. NADA é apagado — o Cliente vira a cara do contato ' +
      'e o Lead segue guardando a história de aquisição (campanha, etapas, IA).',
  })
  vincularCliente(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(vincularLeadClienteSchema)) dto: VincularLeadClienteDto,
  ) {
    return this.mesclagem.vincularLeadCliente(user, dto.leadId, dto.clienteId);
  }

  // ─── Mesclagem de CLIENTES (Fase 2 — fiscal/financeiro, só ADMIN/DIRECTOR) ──

  @Get('clientes/duplicatas')
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({
    summary:
      'Grupos de CLIENTES suspeitos de duplicata (CNPJ, telefone ou e-mail). Só lista. ' +
      'Só ADMIN/Diretor — envolve dado fiscal.',
  })
  duplicatasClientes(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(duplicatasQuerySchema)) q: DuplicatasQueryDto,
  ) {
    return this.mesclagem.duplicatasClientes(user, q.limite);
  }

  @Post('clientes/mesclar/previa')
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({
    summary:
      'Prévia da mesclagem de clientes: pedidos/propostas/amostras que migram, conflitos ' +
      'de preço especial, pontos somados. Comissão fechada NÃO é tocada. Não altera nada.',
  })
  previaCliente(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(mesclarClientesSchema)) dto: MesclarClientesDto,
  ) {
    return this.mesclagem.previaCliente(user, dto.principalId, dto.absorvidoId);
  }

  @Post('clientes/mesclar')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'mesclar_clientes', resource: 'contato' })
  @ApiOperation({
    summary:
      'Funde dois clientes (só CNPJ igual ou um sem CNPJ). Migra os 15 dependentes; ' +
      'preço especial: sobrevivente vence; pontos somados; comissão nunca recalcula. Reversível.',
  })
  mesclarClientes(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(mesclarClientesSchema)) dto: MesclarClientesDto,
  ) {
    return this.mesclagem.mesclarClientes(user, dto.principalId, dto.absorvidoId);
  }

  @Post('mesclagens/:id/desfazer')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'desfazer_mesclagem', resource: 'contato', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Desfaz uma mesclagem: recria o absorvido e devolve os vínculos.' })
  desfazerMesclagem(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.mesclagem.desfazer(user, id);
  }
}
