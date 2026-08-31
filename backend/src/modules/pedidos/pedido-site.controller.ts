import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '@shared/decorators/public.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { PedidoSiteService } from './pedido-site.service';

/**
 * Contrato do checkout. Fechado de propósito: campo desconhecido é descartado
 * (`.strip()` do zod), pra o site não conseguir empurrar coisa que o app não
 * previu — inclusive preço em campo que não existe.
 */
const pedidoDoSiteSchema = z.object({
  /** Número que o cliente vê no site (SB1234). É a chave da idempotência. */
  numeroSite: z.string().trim().min(1).max(40),
  cliente: z.object({
    nome: z.string().trim().min(2).max(160),
    cpfCnpj: z.string().trim().max(20).optional(),
    email: z.string().trim().email().max(160).optional(),
    telefone: z.string().trim().max(30).optional(),
  }),
  itens: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(60),
        quantidade: z.number().int().positive().max(9999),
        valorUnitario: z.number().nonnegative(),
      }),
    )
    .min(1),
  valorFrete: z.number().nonnegative().optional(),
  observacoes: z.string().max(2000).optional(),
  /**
   * Endereço de ENTREGA. Sem ele o pedido nasce sem destino no ERP e a
   * expedição não gera etiqueta — endereço em observação é texto, ninguém
   * imprime a partir dele. Opcional no schema (pedido sem entrega ainda é
   * pedido válido), mas o checkout sempre manda.
   */
  entrega: z
    .object({
      cep: z.string().trim().max(12),
      logradouro: z.string().trim().max(200),
      numero: z.string().trim().max(20).optional(),
      complemento: z.string().trim().max(120).optional(),
      bairro: z.string().trim().max(120).optional(),
      cidade: z.string().trim().max(120).optional(),
      uf: z.string().trim().length(2).optional(),
    })
    .optional(),
});

@ApiTags('pedidos')
@Controller()
export class PedidoSiteController {
  constructor(private readonly svc: PedidoSiteService) {}

  @Public()
  @Post('public/pedidos')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Recebe o pedido do checkout do site (x-api-key, a mesma de /public/leads). ' +
      'Idempotente por numeroSite: reenvio devolve o pedido que já existe.',
  })
  receber(
    @Headers('x-api-key') apiKey: string | undefined,
    @Body(new ZodValidationPipe(pedidoDoSiteSchema)) dto: z.infer<typeof pedidoDoSiteSchema>,
  ) {
    return this.svc.receber(apiKey, dto);
  }
}
