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
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { SERVICO_METADATA, type ServicoEmpresa } from './integracoes.constants';
import {
  type ConectarDto,
  type ListConexoesDto,
  conectarSchema,
  listConexoesSchema,
} from './integracoes.dto';
import { IntegracoesService } from './integracoes.service';

@ApiTags('integracoes')
@ApiBearerAuth()
@Controller('integracoes')
export class IntegracoesController {
  constructor(private readonly integracoes: IntegracoesService) {}

  @Get('servicos')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({ summary: 'Catálogo de serviços de integração suportados' })
  servicos() {
    return Object.entries(SERVICO_METADATA).map(([servico, meta]) => ({
      servico,
      ...meta,
    }));
  }

  @Get()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({ summary: 'Lista conexões da empresa (sem credenciais)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listConexoesSchema)) query: ListConexoesDto,
  ) {
    return this.integracoes.list(user, query);
  }

  @Get(':servico')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  findByServico(@CurrentUser() user: AuthenticatedUser, @Param('servico') servico: ServicoEmpresa) {
    return this.integracoes.findByServico(user, servico);
  }

  @Post('conectar')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'conectar', resource: 'integracao', resourceIdFrom: 'body.servico' })
  @ApiOperation({
    summary: 'Cria ou atualiza credenciais (criptografadas AES-256-GCM)',
  })
  conectar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(conectarSchema)) dto: ConectarDto,
  ) {
    return this.integracoes.conectar(user, dto);
  }

  @Delete(':servico')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'desconectar', resource: 'integracao', resourceIdFrom: 'params.servico' })
  desconectar(@CurrentUser() user: AuthenticatedUser, @Param('servico') servico: ServicoEmpresa) {
    return this.integracoes.desconectar(user, servico);
  }
}
