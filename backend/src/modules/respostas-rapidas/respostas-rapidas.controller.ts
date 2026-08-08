import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
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

  // SEM @Roles: o service é quem protege — `global` só é aceito de quem pode
  // (podeGlobal) e editar/apagar passa pelo assertPodeEditar. O @Roles aqui
  // bloqueava SAC e REP até de criar template PRIVADO, que é justamente quem
  // mais usa resposta rápida no atendimento.
  @Post()
  @ApiOperation({ summary: 'Cria um template (privado; global exige gestão)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(upsertRespostaSchema)) dto: UpsertRespostaDto,
  ) {
    return this.svc.create(user, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Edita um template (o service valida a propriedade)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(upsertRespostaSchema)) dto: UpsertRespostaDto,
  ) {
    return this.svc.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Apaga um template (o service valida a propriedade)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
