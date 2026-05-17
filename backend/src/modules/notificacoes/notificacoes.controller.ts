import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  criarSchema,
  listSchema,
  type CriarNotificacaoDto,
  type ListNotificacoesDto,
} from './notificacoes.dto';
import { NotificacoesService } from './notificacoes.service';

@ApiTags('notificacoes')
@ApiBearerAuth()
@Controller('notificacoes')
export class NotificacoesController {
  constructor(private readonly svc: NotificacoesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista notificações do usuário autenticado (paginado)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listSchema)) params: ListNotificacoesDto,
  ) {
    return this.svc.list(user, params);
  }

  @Get('nao-lidas')
  @ApiOperation({ summary: 'Contagem de não-lidas (endpoint barato pra polling)' })
  naoLidas(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.naoLidas(user);
  }

  @Patch(':id/ler')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marca uma notificação como lida' })
  marcarLida(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.marcarLida(user, id);
  }

  @Patch('ler-todas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marca todas as não-lidas como lidas' })
  marcarTodasLidas(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.marcarTodasLidas(user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apaga uma notificação' })
  deletar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.deletar(user, id);
  }

  @Post()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({
    summary: 'Criar notificação manual (broadcast). ADMIN/DIRECTOR only.',
  })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(criarSchema)) dto: CriarNotificacaoDto,
  ) {
    return this.svc.criarManual(user, dto);
  }
}
