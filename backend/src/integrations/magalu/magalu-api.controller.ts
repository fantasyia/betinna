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
import { caminhoValido, forcarInativo, recusaEscrita } from './magalu-api';
import { MagaluClientService } from './magalu-client.service';

const caminho = z.string().max(300).refine(caminhoValido, 'Caminho inválido');
const valor = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(200), z.number()])).max(100),
]);
const lerSchema = z.object({ caminho, query: z.record(z.string(), valor).optional() });
const escreverSchema = z.object({
  metodo: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  caminho,
  corpo: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()).max(200)]).optional(),
});

/**
 * API crua do Magalu (14/11). Ler é livre; escrever só SKU e preço, sem
 * estoque (Magis5) e sem Full, SKU novo nasce desativado. MEXE NA LOJA — só
 * com o "pode subir" do Léo.
 */
@ApiTags('marketplace/magalu')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('marketplace/magalu/api')
export class MagaluApiController {
  private readonly logger = new Logger(MagaluApiController.name);

  constructor(private readonly magalu: MagaluClientService) {}

  private empresa(user: AuthenticatedUser): string {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role) || !user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Só diretor ou admin chama a API do Magalu',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user.empresaIdAtiva;
  }

  @Post('ler')
  @ApiOperation({
    summary: 'GET em rota do Magalu (anúncio, pedido, SAC, perguntas), resposta crua',
  })
  ler(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(lerSchema)) dto: z.infer<typeof lerSchema>,
  ) {
    return this.magalu.get<unknown>(this.empresa(user), dto.caminho, dto.query);
  }

  @Post('escrever')
  @Audit({ action: 'ESCREVER', resource: 'magalu_api' })
  @ApiOperation({
    summary:
      'Escreve SKU/preço no Magalu, sem estoque e sem Full, SKU novo desativado — MEXE NA LOJA',
  })
  async escrever(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(escreverSchema)) dto: z.infer<typeof escreverSchema>,
  ) {
    const empresaId = this.empresa(user);
    const motivo = recusaEscrita(dto.metodo, dto.caminho, dto.corpo);
    if (motivo) throw new BusinessRuleException(motivo, ErrorCode.BUSINESS_RULE_VIOLATION);
    const { corpo, ajustes } = forcarInativo(dto.metodo, dto.caminho, dto.corpo);
    this.logger.log(
      `magalu_api escrita empresa=${empresaId} usuario=${user.id} ${dto.metodo} ${dto.caminho} ajustes=${ajustes.join('; ') || '-'}`,
    );
    const resposta = await this.magalu.enviar<unknown>(empresaId, dto.metodo, dto.caminho, corpo);
    return { resposta: resposta ?? null, ajustes };
  }
}
