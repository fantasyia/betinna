import { Controller, Logger, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { SheinOrdersService } from './shein-orders.service';
import { SheinPosVendaService } from './shein-pos-venda.service';

const historicoSchema = z.object({
  dias: z.coerce.number().int().min(1).max(90).default(90),
});

/**
 * Histórico de pedidos da Shein (Léo, 01/11: últimos 90 dias) → Vendas
 * marketplaces. Fica em /marketplace (não em /integracoes): importar pedido
 * não é conectar integração, e o escopo "tudo" barra escrita em /integracoes.
 * Roda em segundo plano na api (o IP dela está na lista branca da Shein).
 */
@ApiTags('marketplace/pedidos')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('marketplace/pedidos/shein')
export class SheinHistoricoController {
  private readonly logger = new Logger(SheinHistoricoController.name);

  constructor(
    private readonly pedidos: SheinOrdersService,
    private readonly posVenda: SheinPosVendaService,
  ) {}

  @Post('historico')
  @ApiOperation({
    summary:
      'Importa o histórico de pedidos e de pós-venda da Shein (até 90 dias), em segundo plano',
  })
  historico(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(historicoSchema)) q: z.infer<typeof historicoSchema>,
  ) {
    if (!user.empresaIdAtiva) throw new ForbiddenException('Empresa não definida');
    const desde = new Date(Date.now() - q.dias * 86_400_000);
    void this.pedidos
      .sincronizar(user.empresaIdAtiva, desde, 1)
      .then((r) =>
        this.logger.log(
          `[Shein] histórico ${q.dias} dias: ${r.pedidos} pedidos, ${r.falhas} falhas`,
        ),
      )
      // Pós-venda do mesmo período → Incidentes (01/11).
      .then(() => this.posVenda.sincronizar(user.empresaIdAtiva!, desde, 1))
      .then((r) =>
        this.logger.log(`[Shein] pós-venda ${q.dias} dias: ${r.casos} casos, ${r.falhas} falhas`),
      )
      .catch((err) => this.logger.warn(`[Shein] histórico falhou: ${String(err)}`));
    return { iniciado: true, dias: q.dias };
  }
}
