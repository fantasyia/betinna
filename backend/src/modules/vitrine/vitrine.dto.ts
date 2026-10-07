import { z } from 'zod';

/**
 * Vitrine de atacado — Fase 1 (Ribelt Distribuidora Têxtil, 05/10/2026).
 * DTOs do lado da EMPRESA (cadastro). A vitrine pública tem os dela.
 */

const hexSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #RRGGBB');

/** Dinheiro opcional: null = "sob consulta"/"sem sugerido". Nunca negativo. */
const precoSchema = z.number().nonnegative().max(1_000_000).nullable().optional();

export const vitrineConfigSchema = z.object({
  /** Endereço público `/v/<slug>`: minúsculas, números e hífen. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/,
      'Use 3 a 40 letras minúsculas, números ou hífen',
    ),
  ativa: z.boolean().optional(),
  minimoEntrada: z.number().int().min(1).max(100_000).nullable().optional(),
  minimoVolume: z.number().int().min(1).max(100_000).nullable().optional(),
  minimoAtacadao: z.number().int().min(1).max(100_000).nullable().optional(),
  /** ERP próprio: esconde tamanho esgotado e não aceita pedido além do disponível. */
  respeitaEstoque: z.boolean().optional(),
});
export type VitrineConfigDto = z.infer<typeof vitrineConfigSchema>;

export const corSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  hex: hexSchema,
  ordem: z.number().int().min(0).max(10_000).optional(),
  ativo: z.boolean().optional(),
});
export type CorDto = z.infer<typeof corSchema>;

export const linhaSchema = z.object({
  nome: z.string().trim().min(1).max(40),
  /** Selo da linha na vitrine; vazio/null = sem selo. Ausente = não mexe. */
  selo: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  ordem: z.number().int().min(0).max(10_000).optional(),
  ativo: z.boolean().optional(),
});
export type LinhaDto = z.infer<typeof linhaSchema>;

export const categoriaSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  ordem: z.number().int().min(0).max(10_000).optional(),
  ativo: z.boolean().optional(),
});
export type CategoriaDto = z.infer<typeof categoriaSchema>;

/** Nova ordem dos modelos na vitrine: TODOS os ids da empresa, na ordem. */
export const ordemModelosSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(2000),
});
export type OrdemModelosDto = z.infer<typeof ordemModelosSchema>;

export const tamanhoSchema = z.object({
  nome: z.string().trim().min(1).max(20),
  ordem: z.number().int().min(0).max(10_000).optional(),
  ativo: z.boolean().optional(),
});
export type TamanhoDto = z.infer<typeof tamanhoSchema>;

/** Tabela de medidas de uma linha: cabeçalho + uma linha por tamanho. */
export const tabelaMedidasSchema = z
  .object({
    colunas: z.array(z.string().trim().min(1).max(30)).min(1).max(10),
    linhas: z
      .array(
        z.object({
          tamanho: z.string().trim().min(1).max(20),
          valores: z.array(z.string().trim().max(20)).max(10),
        }),
      )
      .max(40),
  })
  .superRefine((t, ctx) => {
    t.linhas.forEach((l, i) => {
      if (l.valores.length !== t.colunas.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['linhas', i, 'valores'],
          message: 'Cada tamanho precisa de um valor por coluna',
        });
      }
    });
  });

const modeloLinhaSchema = z.object({
  linhaId: z.string().min(1),
  /** Tamanhos DAQUELA linha que o modelo tem. */
  tamanhoIds: z.array(z.string().min(1)).min(1, 'Marque ao menos um tamanho').max(40),
  precoEntrada: precoSchema,
  precoVolume: precoSchema,
  precoAtacadao: precoSchema,
  precoSugerido: precoSchema,
  tabelaMedidas: tabelaMedidasSchema.nullable().optional(),
});

export const modeloSchema = z
  .object({
    nome: z.string().trim().min(1).max(120),
    /** Da lista de categorias da empresa. */
    categoriaId: z.string().min(1).nullable().optional(),
    descricao: z.string().trim().max(4000).nullable().optional(),
    etiquetas: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
    ordem: z.number().int().min(0).max(100_000).optional(),
    ativo: z.boolean().optional(),
    // Kit pra anunciar (marketplace do revendedor).
    tituloMarketplace: z.string().trim().max(60).nullable().optional(),
    descricaoMarketplace: z.string().trim().max(8000).nullable().optional(),
    composicao: z.string().trim().max(200).nullable().optional(),
    /** Cores marcadas, na ordem em que aparecem na vitrine. */
    corIds: z.array(z.string().min(1)).max(40).optional(),
    linhas: z.array(modeloLinhaSchema).max(10).optional(),
  })
  .superRefine((m, ctx) => {
    const cores = m.corIds ?? [];
    if (new Set(cores).size !== cores.length) {
      ctx.addIssue({ code: 'custom', path: ['corIds'], message: 'Cor repetida' });
    }
    const linhas = (m.linhas ?? []).map((l) => l.linhaId);
    if (new Set(linhas).size !== linhas.length) {
      ctx.addIssue({ code: 'custom', path: ['linhas'], message: 'Linha repetida' });
    }
  });
export type ModeloDto = z.infer<typeof modeloSchema>;

export const variacaoPatchSchema = z.object({
  sku: z.string().trim().max(60).nullable().optional(),
  estoque: z.number().int().min(0).max(10_000_000).nullable().optional(),
});
export type VariacaoPatchDto = z.infer<typeof variacaoPatchSchema>;

/** Texto opcional: string vazia vira "não informado". */
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/**
 * Pedido enviado na vitrine PÚBLICA. Só diz o QUÊ e QUANTO — preço e faixa
 * são recalculados no servidor (ver `VitrinePedidoService`).
 */
export const pedidoVitrineSchema = z.object({
  nome: z.string().trim().min(2, 'Informe seu nome').max(120),
  whatsapp: z
    .string()
    .trim()
    .refine((v) => {
      const d = v.replace(/\D/g, '');
      return d.length >= 10 && d.length <= 13;
    }, 'WhatsApp com DDD'),
  cidade: opcional(80),
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'UF com 2 letras')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  cpfCnpj: opcional(20).refine((v) => {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    return d.length === 11 || d.length === 14;
  }, 'CPF ou CNPJ incompleto'),
  observacoes: opcional(500),
  /** Isca pra robô: campo invisível na tela. Gente nunca preenche. */
  site: z.string().max(0).optional(),
  itens: z
    .array(
      z.object({
        corId: z.string().min(1).max(40),
        tamanhoId: z.string().min(1).max(40),
        quantidade: z.number().int().min(1).max(99_999),
      }),
    )
    .min(1, 'Seu pedido está vazio')
    .max(2000),
});
export type PedidoVitrineDto = z.infer<typeof pedidoVitrineSchema>;
