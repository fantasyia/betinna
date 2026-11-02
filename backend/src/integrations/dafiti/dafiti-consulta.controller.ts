import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { DafitiClientService } from './dafiti.client';

/**
 * Consultas de LEITURA no Seller Center da Dafiti com a chave do app (#01,
 * 02/11): a reposição semanal guardava credencial própria fora do app e parou
 * com 401 quando o Léo trocou a chave. Só os caminhos liberados, só GET.
 */
export const CONSULTAS_DAFITI = [
  '/v2/fulfillment-products/stock-on-hand',
  '/v2/purchase-orders',
] as const;

/** Onde cada consulta paginada traz a lista (o resto do corpo é igual). */
const LISTA: Record<string, string> = {
  '/v2/fulfillment-products/stock-on-hand': 'products',
  '/v2/purchase-orders': 'purchaseOrders',
};

const consultaSchema = z.object({
  caminho: z.enum(CONSULTAS_DAFITI),
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(50),
  /** Todas as páginas de uma vez (até 200), juntando a lista. */
  todas: z.enum(['1', 'true']).optional(),
});

interface PaginaDafiti {
  page?: { totalPages?: number; totalElements?: number };
  [k: string]: unknown;
}

@ApiTags('marketplace/dafiti')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('marketplace/dafiti')
export class DafitiConsultaController {
  constructor(private readonly dafiti: DafitiClientService) {}

  @Get('consultar')
  @ApiOperation({
    summary:
      'Leitura no Seller Center da Dafiti com a chave do app (estoque do galpão e envios pro galpão)',
  })
  async consultar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(consultaSchema)) q: z.infer<typeof consultaSchema>,
  ) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    const empresaId = user.empresaIdAtiva;
    if (q.todas === undefined) {
      return this.dafiti.get<PaginaDafiti>(empresaId, q.caminho, { page: q.page, size: q.size });
    }
    const chave = LISTA[q.caminho];
    if (!chave) {
      throw new BusinessRuleException(`Sem paginação conhecida pra ${q.caminho}`);
    }
    const todos: unknown[] = [];
    let total = 0;
    for (let page = 0; page < 200; page++) {
      const r = await this.dafiti.get<PaginaDafiti>(empresaId, q.caminho, { page, size: 100 });
      const lista = Array.isArray(r[chave]) ? (r[chave] as unknown[]) : [];
      todos.push(...lista);
      total = r.page?.totalPages ?? 0;
      if (page + 1 >= total || lista.length === 0) break;
    }
    return { total: todos.length, [chave]: todos };
  }
}
