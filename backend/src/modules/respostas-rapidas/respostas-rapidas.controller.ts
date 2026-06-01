import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type UpsertRespostaDto, upsertRespostaSchema } from './respostas-rapidas.dto';
import { RespostasRapidasService } from './respostas-rapidas.service';

/**
 * Sprint 2.3 — Respostas rápidas / templates da Inbox.
 *
 * GET é aberto a quem usa a Inbox (todos), pra inserir templates ao responder.
 * Criar/editar/apagar é pra quem gerencia (ADMIN/DIRECTOR/GERENTE) — a regra de
 * global vs privado é aplicada no service.
 */
@ApiTags('respostas-rapidas')
@ApiBearerAuth()
@Controller('respostas-rapidas')
export class RespostasRapidasController {
  constructor(private readonly svc: RespostasRapidasService) {}

  @Get()
  @ApiOperation({ summary: 'Lista templates (globais da empresa + privados do usuário)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(user);
  }

  @Post()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({ summary: 'Cria um template' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(upsertRespostaSchema)) dto: UpsertRespostaDto,
  ) {
    return this.svc.create(user, dto);
  }

  @Put(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({ summary: 'Edita um template' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(upsertRespostaSchema)) dto: UpsertRespostaDto,
  ) {
    return this.svc.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({ summary: 'Apaga um template' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
