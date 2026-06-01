import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { BotAuditoriaService } from './bot-auditoria.service';
import { BotCustoService } from './bot-custo.service';

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['OK', 'FALLBACK', 'SEM_RESPOSTA']).optional(),
  marcadaRevisao: z.enum(['true', 'false']).optional(),
  de: z.string().optional(),
  ate: z.string().optional(),
});
type ListDto = z.infer<typeof listSchema>;

/** Converte o DTO da query (marcadaRevisao string) pros filtros do serviço. */
function toFiltros(q: ListDto) {
  return {
    page: q.page,
    limit: q.limit,
    status: q.status,
    de: q.de,
    ate: q.ate,
    marcadaRevisao: q.marcadaRevisao === undefined ? undefined : q.marcadaRevisao === 'true',
  };
}

/**
 * Sprint 2.2 — Auditoria das respostas do bot + status de custo.
 * Acessível a quem gerencia o bot (ADMIN/DIRECTOR/GERENTE).
 */
@ApiTags('mullerbot')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR', 'GERENTE')
@Controller('mullerbot')
export class BotAuditoriaController {
  constructor(
    private readonly auditoria: BotAuditoriaService,
    private readonly custo: BotCustoService,
  ) {}

  private empresaId(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    return id;
  }

  @Get('auditoria')
  @ApiOperation({ summary: 'Lista as respostas do bot (auditoria) com filtros' })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listSchema)) q: ListDto,
  ) {
    return this.auditoria.listar(this.empresaId(user), toFiltros(q));
  }

  @Get('auditoria/export')
  @ApiOperation({ summary: 'Exporta a auditoria filtrada em CSV' })
  async exportar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listSchema)) q: ListDto,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.auditoria.exportarCsv(this.empresaId(user), toFiltros(q));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="auditoria-bot.csv"');
    // BOM pra o Excel abrir acentos corretamente.
    res.send('﻿' + csv);
  }

  @Get('custo')
  @ApiOperation({ summary: 'Status de consumo de tokens do bot (dia/mês) + teto' })
  statusCusto(@CurrentUser() user: AuthenticatedUser) {
    return this.custo.statusCusto(this.empresaId(user));
  }
}
