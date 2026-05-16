import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { ServicoUsuario } from './integracoes.constants';
import {
  type ConectarUsuarioDto,
  type ListConexoesUsuarioDto,
  conectarUsuarioSchema,
  listConexoesUsuarioSchema,
} from './integracoes.dto';
import { UsuarioIntegracoesService } from './usuario-integracoes.service';

/**
 * Conexões de integração com escopo USUÁRIO.
 * Cada rep tem suas próprias credenciais (Google Calendar, SendGrid, etc.).
 *
 * Todos endpoints operam no `user.id` da request — sem multi-tenant cross-user.
 */
@ApiTags('integracoes-usuario')
@ApiBearerAuth()
@Controller('usuario/integracoes')
export class UsuarioIntegracoesController {
  constructor(private readonly svc: UsuarioIntegracoesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista conexões do usuário atual (sem credenciais)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listConexoesUsuarioSchema)) query: ListConexoesUsuarioDto,
  ) {
    return this.svc.list(user, query);
  }

  @Get(':servico')
  findByServico(
    @CurrentUser() user: AuthenticatedUser,
    @Param('servico') servico: ServicoUsuario,
  ) {
    return this.svc.findByServico(user, servico);
  }

  @Post('conectar')
  @Audit({ action: 'conectar', resource: 'usuario-integracao', resourceIdFrom: 'body.servico' })
  @ApiOperation({ summary: 'Cria/atualiza credenciais (cifradas AES-256-GCM)' })
  conectar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(conectarUsuarioSchema)) dto: ConectarUsuarioDto,
  ) {
    return this.svc.conectar(user, dto);
  }

  @Delete(':servico')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'desconectar', resource: 'usuario-integracao', resourceIdFrom: 'params.servico' })
  desconectar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('servico') servico: ServicoUsuario,
  ) {
    return this.svc.desconectar(user, servico);
  }
}
