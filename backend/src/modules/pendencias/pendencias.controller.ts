import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { PendenciasIaService } from './pendencias-ia.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { STATUS_PENDENCIA, type StatusPendencia } from './pendencias';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { PendenciasService } from './pendencias.service';

/** Liga/desliga a IA das pendências (e por tipo). */
const iaSchema = z.object({
  ativo: z.boolean(),
  desligados: z.array(z.enum(['PERGUNTA', 'MENSAGEM', 'RECLAMACAO', 'DEVOLUCAO'])).max(4),
});

@ApiTags('pendencias')
@ApiBearerAuth()
@Controller('pendencias')
export class PendenciasController {
  constructor(
    private readonly pendencias: PendenciasService,
    private readonly ia: PendenciasIaService,
  ) {}

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
  async verificar(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.empresa(user);
    const r = await this.pendencias.rodada(empresaId);
    const ia = await this.ia.processar(empresaId);
    return { ...r, ia };
  }

  @Get('ia')
  @ApiOperation({ summary: 'IA das pendências: ligada e tipos desligados' })
  configIa(@CurrentUser() user: AuthenticatedUser) {
    return this.ia.config(this.empresa(user));
  }

  @Put('ia')
  @ApiOperation({ summary: 'Liga/desliga a IA das pendências (e por tipo)' })
  salvarIa(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(iaSchema)) dto: z.infer<typeof iaSchema>,
  ) {
    return this.pendencias.salvarConfigIa(this.empresa(user), dto);
  }

  @Post('ia/simular')
  @ApiOperation({
    summary: 'Testar a IA: o que ela responderia nas últimas conversas reais (não envia nada)',
  })
  simularIa(@CurrentUser() user: AuthenticatedUser) {
    return this.ia.simular(this.empresa(user));
  }

  @Post(':id/resolver')
  @ApiOperation({ summary: 'Marca a pendência como resolvida (a equipe já cuidou)' })
  resolver(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pendencias.resolver(this.empresa(user), id);
  }

  @Get(':id/respostas')
  @ApiOperation({ summary: 'O que a IA respondeu (ou escalou) nesta pendência' })
  respostas(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ia.respostas(this.empresa(user), id);
  }
}
