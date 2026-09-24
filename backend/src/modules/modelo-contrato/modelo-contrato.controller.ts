import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type EnviarModeloDto, enviarModeloSchema } from './modelo-contrato.dto';
import { ModeloContratoService } from './modelo-contrato.service';

/**
 * Modelo do contrato (documento único do Anexo I) — trocado pela tela, sem deploy.
 *
 * DIRECTOR/ADMIN: o texto é cláusula contratual (mesma régua do D46). E toda
 * escrita é AUDITADA (pedido do Léo, 24/09): trocar o modelo muda o que o
 * próximo cliente assina, então "quem ativou a versão 4?" tem que ter resposta.
 *
 * Rota em `/modelos-contrato` e não `/contratos/modelo`: o `GET /contratos/:id`
 * engoliria "modelo" como id.
 */
@ApiTags('contratos')
@ApiBearerAuth()
@Controller('modelos-contrato')
@Roles('ADMIN', 'DIRECTOR')
export class ModeloContratoController {
  constructor(private readonly modelos: ModeloContratoService) {}

  @Get()
  @ApiOperation({ summary: 'Versões do modelo, qual está em uso e o padrão do app' })
  listar(@CurrentUser() user: AuthenticatedUser) {
    return this.modelos.listar(user);
  }

  @Post()
  @Audit({ action: 'enviar', resource: 'modelo_contrato', resourceIdFrom: 'response.id' })
  @ApiOperation({
    summary: 'Sobe uma versão nova (inativa). Recusa com a lista do que está errado.',
  })
  enviar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(enviarModeloSchema)) dto: EnviarModeloDto,
  ) {
    return this.modelos.enviar(user, dto);
  }

  // Rotas fixas ANTES das com `:id` — senão "padrao" vira um id.
  @Post('padrao/ativar')
  @Audit({ action: 'voltar_ao_padrao', resource: 'modelo_contrato' })
  @ApiOperation({ summary: 'Volta a usar o modelo do app (nenhuma versão ativa)' })
  voltarAoPadrao(@CurrentUser() user: AuthenticatedUser) {
    return this.modelos.voltarAoPadrao(user);
  }

  @Get('padrao/arquivo')
  @ApiOperation({ summary: 'O .docx padrão do app, pra editar no Word' })
  arquivoPadrao(@CurrentUser() user: AuthenticatedUser) {
    return this.modelos.arquivo(user, 'padrao');
  }

  @Get('padrao/exemplo')
  @ApiOperation({ summary: 'O padrão preenchido com uma proposta de exemplo (40 quadros)' })
  exemploPadrao(@CurrentUser() user: AuthenticatedUser) {
    return this.modelos.exemplo(user, 'padrao');
  }

  @Post(':id/ativar')
  @Audit({ action: 'ativar', resource: 'modelo_contrato', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Passa a valer esta versão (revalida antes)' })
  ativar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.modelos.ativar(user, id);
  }

  @Get(':id/arquivo')
  @ApiOperation({ summary: 'O .docx desta versão' })
  arquivo(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.modelos.arquivo(user, id);
  }

  @Get(':id/exemplo')
  @ApiOperation({ summary: 'Esta versão preenchida com a proposta de exemplo' })
  exemplo(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.modelos.exemplo(user, id);
  }
}
