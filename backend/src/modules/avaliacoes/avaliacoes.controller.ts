import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { AvaliacoesService } from './avaliacoes.service';

const decidirSchema = z.object({ status: z.enum(['APROVADA', 'RECUSADA']) });

/** Avaliações da Shopee na vitrine: revisão do Léo (25/10). */
@ApiTags('avaliacoes')
@ApiBearerAuth()
@Controller('vitrine/admin/avaliacoes')
export class AvaliacoesController {
  constructor(private readonly svc: AvaliacoesService) {}

  @Get()
  @ApiOperation({ summary: 'Avaliações importadas (com o veredito da IA)' })
  listar(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.svc.listar(user, status && /^[A-Z]{1,20}$/.test(status) ? status : undefined);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Aprova ou recusa (vale a palavra do Léo)' })
  decidir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decidirSchema)) dto: z.infer<typeof decidirSchema>,
  ) {
    return this.svc.decidir(user, id, dto.status);
  }

  @Post('importar')
  @ApiOperation({ summary: 'Busca as avaliações novas agora (a rotina roda 1x por dia)' })
  importar(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.importarAgora(user);
  }
}
