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
  UsePipes,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  submitNpsSchema,
  upsertPesquisaSchema,
  type SubmitNpsDto,
  type UpsertPesquisaDto,
} from './nps.dto';
import { NpsService } from './nps.service';

@ApiTags('nps')
@Controller('nps')
export class NpsController {
  constructor(private readonly svc: NpsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(user);
  }

  @Get(':id')
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.getById(user, id);
  }

  @Get(':id/dashboard')
  @ApiOperation({ summary: 'Score + distribuição + respostas recentes' })
  dashboard(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.dashboard(user, id);
  }

  @Post()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'create', resource: 'nps-pesquisa' })
  @UsePipes(new ZodValidationPipe(upsertPesquisaSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertPesquisaDto) {
    return this.svc.upsert(user, null, dto);
  }

  @Put(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'update', resource: 'nps-pesquisa', resourceIdFrom: 'params.id' })
  @UsePipes(new ZodValidationPipe(upsertPesquisaSchema))
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertPesquisaDto,
  ) {
    return this.svc.upsert(user, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'delete', resource: 'nps-pesquisa', resourceIdFrom: 'params.id' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.delete(user, id);
  }
}

/**
 * Endpoint público — sem auth. /n/:slug
 *
 * Rotas públicas (qualquer um na internet acessa), então têm rate-limit PRÓPRIO
 * por IP (o tracker do throttler resolve o IP real via trust proxy=1). Sem isso,
 * um script poderia floodar a métrica de NPS do cliente. O `submitPublico` ainda
 * deduplica por (pesquisa, IP) pra ninguém responder 2× — defesa em camadas.
 */
@ApiTags('nps-publico')
@Controller('n')
export class NpsPublicoController {
  constructor(private readonly svc: NpsService) {}

  @Public()
  @Get(':slug')
  // Leitura da pesquisa: 30/min por IP — generoso pra uso real, barra scraping.
  @Throttle({ default: { limit: 30, ttl: seconds(60) } })
  getPublico(@Param('slug') slug: string) {
    return this.svc.getPublicBySlug(slug);
  }

  @Public()
  @Post(':slug/submit')
  // Envio de resposta: 5/h por IP. Pessoa real responde 1×; isso barra flood
  // mantendo folga pra retries/correções. Combina com a dedup por IP no service.
  @Throttle({ default: { limit: 5, ttl: seconds(60 * 60) } })
  @UsePipes(new ZodValidationPipe(submitNpsSchema))
  submit(
    @Param('slug') slug: string,
    @Body() dto: SubmitNpsDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.svc.submitPublico(slug, dto, { ip, userAgent });
  }
}
