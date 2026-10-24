import { Controller, ForbiddenException, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { STATUS_PENDENCIA, type StatusPendencia } from './pendencias';
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
    summary:
      'Pendências dos marketplaces (pré-venda, pós-venda, reclamações, devoluções) com filtros',
  })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query('busca') busca?: string,
    @Query('canal') canal?: string,
    @Query('tipo') tipo?: string,
    @Query('status') status?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    const st = STATUS_PENDENCIA.includes(status as StatusPendencia)
      ? (status as StatusPendencia)
      : undefined;
    return this.pendencias.listar(this.empresa(user), { busca, canal, tipo, status: st, de, ate });
  }

  @Post('verificar')
  @ApiOperation({ summary: 'Roda a conferência agora (a rotina roda sozinha de hora em hora)' })
  verificar(@CurrentUser() user: AuthenticatedUser) {
    return this.pendencias.rodada(this.empresa(user));
  }
}
