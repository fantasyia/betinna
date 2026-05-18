import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  Post,
  Put,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  submeterRespostaSchema,
  upsertFormularioSchema,
  type SubmeterRespostaDto,
  type UpsertFormularioDto,
} from './formularios.dto';
import { FormulariosService } from './formularios.service';

@ApiTags('formularios')
@Controller('formularios')
export class FormulariosController {
  constructor(private readonly svc: FormulariosService) {}

  @Get()
  @ApiOperation({ summary: 'Listar formulários da empresa' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um formulário' })
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.getById(user, id);
  }

  @Post()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'create', resource: 'formulario' })
  @UsePipes(new ZodValidationPipe(upsertFormularioSchema))
  @ApiOperation({ summary: 'Criar formulário' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertFormularioDto) {
    return this.svc.upsert(user, null, dto);
  }

  @Put(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'update', resource: 'formulario', resourceIdFrom: 'params.id' })
  @UsePipes(new ZodValidationPipe(upsertFormularioSchema))
  @ApiOperation({ summary: 'Atualizar formulário' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertFormularioDto,
  ) {
    return this.svc.upsert(user, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'delete', resource: 'formulario', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Excluir formulário (e respostas)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.delete(user, id);
  }

  @Get(':id/respostas')
  @ApiOperation({ summary: 'Últimas respostas recebidas' })
  respostas(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listRespostas(user, id, limit ? Number(limit) : 50);
  }
}

/**
 * Endpoint público — sem auth. Acessível em /api/v1/f/:slug.
 * Throttle aplicado via @Throttle global (rate limit por IP).
 */
@ApiTags('formularios-publico')
@Controller('f')
export class FormulariosPublicoController {
  constructor(private readonly svc: FormulariosService) {}

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Buscar formulário público (sem auth)' })
  getPublico(@Param('slug') slug: string) {
    return this.svc.getPublicBySlug(slug);
  }

  @Public()
  @Post(':slug/submit')
  @UsePipes(new ZodValidationPipe(submeterRespostaSchema))
  @ApiOperation({ summary: 'Submeter resposta (público)' })
  submit(
    @Param('slug') slug: string,
    @Body() dto: SubmeterRespostaDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.svc.submitPublico(slug, dto, { ip, userAgent });
  }
}
