import { Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { PendenciasService } from './pendencias.service';

@ApiTags('pendencias')
@ApiBearerAuth()
@Controller('pendencias')
export class PendenciasController {
  constructor(private readonly pendencias: PendenciasService) {}

  private empresa(user: AuthenticatedUser): string {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role) || !user.empresaIdAtiva) {
      throw new ForbiddenException('Só diretor ou admin vê as pendências dos marketplaces');
    }
    return user.empresaIdAtiva;
  }

  @Get()
  @ApiOperation({
    summary: 'Pendências abertas dos marketplaces (perguntas, mensagens, reclamações, devoluções)',
  })
  listar(@CurrentUser() user: AuthenticatedUser) {
    return this.pendencias.listarAbertas(this.empresa(user));
  }

  @Post('verificar')
  @ApiOperation({ summary: 'Roda a conferência agora (a rotina roda sozinha de hora em hora)' })
  verificar(@CurrentUser() user: AuthenticatedUser) {
    return this.pendencias.rodada(this.empresa(user));
  }
}
