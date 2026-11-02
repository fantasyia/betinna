import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { horaShein } from './shein-assinatura';
import {
  consultaPermitida,
  corpoPreco,
  resultadoPreco,
  resumoSpu,
  type SheinSpuInfo,
} from './shein-anuncios';
import { SheinClientService } from './shein.client';

const listarSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
  /** Só os atualizados nas últimas N horas (ausente = todos). */
  horas: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .optional(),
});

const precoSchema = z.object({
  itens: z
    .array(
      z.object({
        skuCode: z.string().trim().min(1).max(60),
        preco: z.number().positive().max(100_000),
        precoPromocional: z.number().positive().max(100_000).nullable(),
        site: z.string().trim().min(1).max(40).optional(),
        moeda: z.string().trim().length(3).optional(),
        motivoAumento: z.number().int().min(1).max(5).optional(),
      }),
    )
    .min(1)
    .max(100),
});

const editarSchema = z.object({ spu_name: z.string().trim().min(1).max(60) }).passthrough();

const consultarSchema = z.object({
  caminho: z.string().trim().min(1).max(120),
  corpo: z.record(z.unknown()).default({}),
});

/**
 * Anúncios da Shein (#05, Léo 01/11): listar, ver, mudar preço e editar
 * variações. Mudar preço e editar MEXEM NA LOJA (a Shein revisa a edição) —
 * só com o OK do Léo. Fica em /marketplace (escrita em /integracoes é barrada
 * pro token "tudo"). Roda na api, cujo IP está na lista branca da Shein.
 */
@ApiTags('marketplace/anuncios')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('marketplace/anuncios/shein')
export class SheinAnunciosController {
  constructor(private readonly shein: SheinClientService) {}

  private empresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  @Get()
  @ApiOperation({ summary: 'Anúncios aprovados da Shein: SPU → SKC (cor) → SKU (códigos)' })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listarSchema)) q: z.infer<typeof listarSchema>,
  ) {
    const desde = q.horas ? new Date(Date.now() - q.horas * 3_600_000) : null;
    return this.shein.post(this.empresa(user), '/open-api/openapi-business-backend/product/query', {
      pageNum: q.pagina,
      pageSize: q.porPagina,
      ...(desde ? { updateTimeStart: horaShein(desde), updateTimeEnd: horaShein(new Date()) } : {}),
    });
  }

  @Get(':spuName')
  @ApiOperation({
    summary: 'Um anúncio: cores, tamanhos, SKU do vendedor, preço e status (cru com ?cru=1)',
  })
  async ver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spuName') spuName: string,
    @Query('cru') cru?: string,
  ) {
    const info = await this.shein.post<SheinSpuInfo>(
      this.empresa(user),
      '/open-api/goods/spu-info',
      {
        languageList: ['pt-br'],
        spuName,
      },
    );
    return cru === '1' ? info : resumoSpu(info ?? {});
  }

  @Post('preco')
  @ApiOperation({
    summary: 'MEXE NA LOJA — muda o preço por SKU (até 100), devolve aceitos/em revisão/recusados',
  })
  async preco(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(precoSchema)) dto: z.infer<typeof precoSchema>,
  ) {
    let corpo: ReturnType<typeof corpoPreco>;
    try {
      corpo = corpoPreco(dto.itens);
    } catch (err) {
      throw new BusinessRuleException((err as Error).message, ErrorCode.BUSINESS_RULE_VIOLATION);
    }
    const r = await this.shein.post<{ data?: Parameters<typeof resultadoPreco>[0] }>(
      this.empresa(user),
      '/open-api/openapi-business-backend/product/price/save',
      corpo,
    );
    return resultadoPreco(r?.data ?? []);
  }

  @Post('editar')
  @ApiOperation({
    summary:
      'MEXE NA LOJA — edição parcial (/goods/product/partialEdit): criar cor/tamanho, SKU do vendedor, fotos. A Shein revisa.',
  })
  editar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(editarSchema)) dto: z.infer<typeof editarSchema>,
  ) {
    return this.shein.post(this.empresa(user), '/open-api/goods/product/partialEdit', dto);
  }

  @Post('consultar')
  @ApiOperation({ summary: 'Consulta de leitura da Open API (só os caminhos liberados)' })
  consultar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(consultarSchema)) dto: z.infer<typeof consultarSchema>,
  ) {
    if (!consultaPermitida(dto.caminho)) {
      throw new BusinessRuleException(
        `Caminho não liberado pra consulta: ${dto.caminho}`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    return this.shein.post(this.empresa(user), dto.caminho, dto.corpo);
  }
}
