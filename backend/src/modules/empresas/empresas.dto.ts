import { z } from 'zod';

export const createEmpresaSchema = z.object({
  nome: z.string().min(2).max(200),
  cnpj: z
    .string()
    .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, 'CNPJ deve seguir o formato 00.000.000/0001-00')
    .optional(),
  ramo: z.string().max(100).optional(),
  cidade: z.string().max(100).optional(),
  uf: z.string().length(2).optional(),
  subtitulo: z.string().max(200).optional(),
  // B1 (Lote 6) — Desconto à vista automático (0 = desligado). Máx 50%.
  // Aplicado em PIX (descontoPixPct) e BOLETO+condição=avista (descontoBoletoAvistaPct).
  descontoPixPct: z.number().min(0).max(50).optional(),
  descontoBoletoAvistaPct: z.number().min(0).max(50).optional(),
  // Fase 2 — liga/desliga global do bot Muller no WhatsApp da empresa.
  botWhatsappAtivo: z.boolean().optional(),
});

export type CreateEmpresaDto = z.infer<typeof createEmpresaSchema>;

export const updateEmpresaSchema = createEmpresaSchema.partial();
export type UpdateEmpresaDto = z.infer<typeof updateEmpresaSchema>;

export const listEmpresasSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  ativo: z.coerce.boolean().optional(),
});
export type ListEmpresasDto = z.infer<typeof listEmpresasSchema>;

// ─── ConfiguracaoTenant (no-code) ─────────────────────────────────────────
// Patch parcial da config da empresa (Admin Panel). `passthrough` deixa novos
// consumidores entrarem sem mudar o schema; valida só as chaves conhecidas.

/** Metadados por status do lifecycle de pedido (1º consumidor). Chave = PedidoStatus. */
const pedidoStatusMetaSchema = z.object({
  /** Nome custom exibido pro tenant (ex: "Em produção" no lugar de "Enviado ao OMIE"). */
  label: z.string().trim().max(40).optional(),
  /** Cor (variant do Badge) — alinhado ao design system do app. */
  variant: z.enum(['neutral', 'warning', 'info', 'success', 'primary', 'danger']).optional(),
});

/**
 * Pedido mínimo configurável por tenant (2º consumidor da ConfiguracaoTenant).
 * MSM: por peso, 250 kg mínimo. `tipo='combinada'` avalia os limites setados
 * com `modo` E (todos) / OU (qualquer um). `sem_minimo` = sem trava (default).
 */
const pedidoMinimoSchema = z
  .object({
    tipo: z
      .enum(['sem_minimo', 'por_valor', 'por_peso', 'por_quantidade', 'combinada'])
      .default('sem_minimo'),
    /** Valor mínimo em R$ (soma dos itens). */
    valorMin: z.number().nonnegative().optional(),
    /** Peso mínimo em kg (Σ quantidade × pesoPorUnidade do produto). */
    pesoMin: z.number().nonnegative().optional(),
    /** Quantidade mínima de unidades (Σ quantidade dos itens). */
    quantidadeMin: z.number().int().nonnegative().optional(),
    /** Combinador pra tipo='combinada': E (todos os limites) ou OU (qualquer um). */
    modo: z.enum(['E', 'OU']).optional(),
  })
  .optional();

/**
 * Amostra: modos + elegibilidade + fila de aprovação (3º consumidor).
 * MSM: subsidiada + compra_propria ativos; elegibilidade por média kg/mês.
 */
const amostraModosSchema = z
  .object({
    modosAtivos: z
      .object({
        subsidiada: z.boolean(),
        compra_propria: z.boolean(),
        compra_cliente: z.boolean(),
      })
      .partial()
      .optional(),
    elegibilidadeSubsidiada: z
      .object({
        tipo: z.enum(['sempre', 'media_kg_mes', 'manual']),
        minKgMes: z.number().nonnegative(),
        mesesJanela: z.number().int().positive().max(24),
      })
      .partial()
      .optional(),
    exigeAprovacaoSubsidiada: z.boolean().optional(),
  })
  .optional();

/**
 * Comissão escalonada por faturamento (4º consumidor). modelo 'fixa' = atual
 * (soma do comissao por pedido); 'escalonada_por_faturamento' = faturamento × % da faixa.
 */
const comissaoBonusSchema = z
  .object({
    modelo: z.enum(['fixa', 'escalonada_por_faturamento']),
    faixas: z
      .array(
        z.object({
          de: z.number().nonnegative(),
          ate: z.number().nonnegative().nullable(),
          percentual: z.number().min(0).max(100),
        }),
      )
      .optional(),
  })
  .optional();

/** Materiais de venda: tipos configuráveis (5º consumidor). */
const materiaisTiposSchema = z
  .object({
    tipos: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(40),
          label: z.string().trim().min(1).max(60),
        }),
      )
      .optional(),
  })
  .optional();

/** Devolução interna: motivos + SLA + janela (6º consumidor). */
const devolucaoInternaSchema = z
  .object({
    motivos: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(40),
          label: z.string().trim().min(1).max(60),
          fotosObrigatorias: z.boolean().optional(),
        }),
      )
      .optional(),
    slaAnaliseDiasUteis: z.number().int().nonnegative().max(60).optional(),
    janelaPosEntregaDias: z.number().int().nonnegative().max(365).optional(),
    estornoComissaoProporcional: z.boolean().optional(),
  })
  .optional();

export const tenantConfigPatchSchema = z
  .object({
    pedidoStatusLabels: z.record(z.string(), pedidoStatusMetaSchema).optional(),
    pedidoMinimo: pedidoMinimoSchema,
    amostraModos: amostraModosSchema,
    comissaoBonus: comissaoBonusSchema,
    materiaisVenda: materiaisTiposSchema,
    devolucaoInterna: devolucaoInternaSchema,
  })
  .passthrough();
export type TenantConfigPatchDto = z.infer<typeof tenantConfigPatchSchema>;
