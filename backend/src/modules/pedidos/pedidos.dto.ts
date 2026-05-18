import { PagamentoForma, PedidoStatus } from '@prisma/client';
import { z } from 'zod';

const QTY_MIN = 1;
const DISC_MIN = 0;
const DISC_MAX_ITEM = 80;
const DISC_MAX_GERAL = 50;

export const pedidoItemInputSchema = z.object({
  produtoId: z.string().cuid(),
  quantidade: z.number().int().min(QTY_MIN).max(100_000),
  /** % desconto aplicado neste item (0-80) */
  desconto: z.number().min(DISC_MIN).max(DISC_MAX_ITEM).default(0),
  /** Quando informado, sobrescreve o preço resolvido pelo PricingService. Use com cuidado. */
  precoUnitarioOverride: z.number().positive().optional(),
});
export type PedidoItemInputDto = z.infer<typeof pedidoItemInputSchema>;

export const createPedidoSchema = z.object({
  clienteId: z.string().cuid(),
  itens: z.array(pedidoItemInputSchema).min(1, 'Pedido precisa ter ao menos 1 item'),
  formaPagamento: z.nativeEnum(PagamentoForma).default('BOLETO'),
  condicaoPagamento: z.enum(['avista', '15dias', '30dias', '30_60', '30_60_90']).default('30dias'),
  prazoEntrega: z.coerce.date().optional(),
  descontoGeral: z.number().min(DISC_MIN).max(DISC_MAX_GERAL).default(0),
  observacoes: z.string().max(2000).optional(),
  motivoDesconto: z.string().max(500).optional(),
});
export type CreatePedidoDto = z.infer<typeof createPedidoSchema>;

export const updatePedidoSchema = createPedidoSchema
  .omit({ clienteId: true, itens: true })
  .partial()
  .extend({
    /**
     * Quando fornecido, substitui TODOS os itens do pedido (replace).
     * Backend recalcula subtotal/total/comissão. Só funciona em RASCUNHO
     * ou AGUARDANDO_APROVACAO — outros status rejeitam.
     */
    itens: z.array(pedidoItemInputSchema).min(1).optional(),
  });
export type UpdatePedidoDto = z.infer<typeof updatePedidoSchema>;

export const previewPedidoSchema = createPedidoSchema;
export type PreviewPedidoDto = CreatePedidoDto;

export const listPedidosSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['criadoEm', 'total', 'numero']).default('criadoEm'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  status: z.nativeEnum(PedidoStatus).optional(),
  clienteId: z.string().cuid().optional(),
  representanteId: z.string().cuid().optional(),
  dataInicio: z.coerce.date().optional(),
  dataFim: z.coerce.date().optional(),
});
export type ListPedidosDto = z.infer<typeof listPedidosSchema>;

export const cancelarPedidoSchema = z.object({
  motivo: z.string().max(500).optional(),
});
export type CancelarPedidoDto = z.infer<typeof cancelarPedidoSchema>;
