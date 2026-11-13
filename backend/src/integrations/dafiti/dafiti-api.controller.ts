import { Body, Controller, Logger, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CAMINHO_DAFITI, forcarInativo, recusaEscrita, recusaQuery } from './dafiti-api';
import { DafitiClientService } from './dafiti.client';

const caminho = z
  .string()
  .max(300)
  .regex(CAMINHO_DAFITI)
  .refine((c) => !c.includes('..'), 'Caminho inválido');
const valor = z.union([
  z.string().max(2000),
  z.number(),
  z.array(z.union([z.string().max(200), z.number()])).max(100),
]);
const lerSchema = z.object({ caminho, query: z.record(z.string(), valor).optional() });
const escreverSchema = z.object({
  metodo: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  caminho,
  corpo: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()).max(200)]).optional(),
  /** Só `status` (ativar/desativar variação vai na URL). */
  query: z.record(z.string(), z.string().max(20)).optional(),
});

/**
 * API crua do Seller Center da Dafiti (13/11). Ler qualquer /v2; escrever só
 * anúncio, sem estoque, sem Full, criação nasce inativa. MEXE NA LOJA — só com
 * o "pode subir" do Léo.
 */
@ApiTags('marketplace/dafiti')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('marketplace/dafiti/api')
export class DafitiApiController {
  private readonly logger = new Logger(DafitiApiController.name);

  constructor(private readonly dafiti: DafitiClientService) {}

  private empresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  @Post('ler')
  @ApiOperation({ summary: 'GET em qualquer rota /v2 do Seller Center, resposta crua' })
  ler(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(lerSchema)) dto: z.infer<typeof lerSchema>,
  ) {
    const q: Record<string, string | number | string[]> = {};
    for (const [k, v] of Object.entries(dto.query ?? {})) {
      q[k] = Array.isArray(v) ? v.map(String) : v;
    }
    return this.dafiti.get<unknown>(this.empresa(user), dto.caminho, q);
  }

  @Post('escrever')
  @Audit({ action: 'ESCREVER', resource: 'dafiti_api' })
  @ApiOperation({
    summary: 'Escreve em anúncio da Dafiti, sem estoque e sem Full, criação inativa — MEXE NA LOJA',
  })
  async escrever(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(escreverSchema)) dto: z.infer<typeof escreverSchema>,
  ) {
    const empresaId = this.empresa(user);
    const motivo = recusaEscrita(dto.metodo, dto.caminho, dto.corpo) ?? recusaQuery(dto.query);
    if (motivo) throw new BusinessRuleException(motivo, ErrorCode.BUSINESS_RULE_VIOLATION);
    const { corpo, ajustes } = forcarInativo(dto.metodo, dto.caminho, dto.corpo);
    this.logger.log(
      `dafiti_api escrita empresa=${empresaId} usuario=${user.id} ${dto.metodo} ${dto.caminho} ajustes=${ajustes.join('; ') || '-'}`,
    );
    const qs = new URLSearchParams(dto.query ?? {}).toString();
    const resposta = await this.dafiti.enviar<unknown>(
      empresaId,
      dto.metodo,
      qs ? `${dto.caminho}?${qs}` : dto.caminho,
      corpo,
    );
    return { resposta: resposta ?? null, ajustes };
  }
}
