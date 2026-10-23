import { z } from 'zod';

/** ERP próprio · entrega 4 — ordem de produção. */

const id = z.string().min(1).max(40);
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const semRepetir = <T extends { produtoId?: string; insumoId?: string }>(xs: T[]) =>
  new Set(xs.map((x) => x.produtoId ?? x.insumoId)).size === xs.length;

/** Grade da OP: quantas peças de cada variação (cor × linha × tamanho). */
const gradeSchema = z
  .array(z.object({ produtoId: id, quantidade: z.number().int().min(1).max(100_000) }))
  .min(1, 'Monte a grade da OP')
  .max(2000)
  .refine(semRepetir, 'Variação repetida na grade');

/** Etapas do kanban da produção, na ordem do chão de fábrica (Léo, 14/10). */
export const ETAPAS_OP = [
  'RASCUNHO',
  'IMPRESSAO_RISCO',
  'CORTE',
  'COSTURA',
  'ACABAMENTO',
  'CONFERENCIA',
  'CONCLUIDO',
] as const;
export type EtapaOp = (typeof ETAPAS_OP)[number];
export const etapaOpSchema = z.object({ etapa: z.enum(ETAPAS_OP) });
export type EtapaOpDto = z.infer<typeof etapaOpSchema>;

export const simularOpSchema = z.object({
  modeloId: id,
  faccaoId: id.nullable().optional(),
  itens: gradeSchema,
});
export type SimularOpDto = z.infer<typeof simularOpSchema>;

/**
 * Grade do risco (Léo, 14/10): a OP montada "2M 2G 1GG × grades por cor". Uma
 * grade por OP, uma linha por grade (decisão do Léo). Só referência — quem
 * manda são os `itens`; volta preenchida no "Gerar risco" do encaixe.
 */
const gradeRiscoSchema = z.object({
  linha: z.string().trim().min(1).max(60),
  composicao: z
    .array(
      z.object({
        tamanho: z.string().trim().min(1).max(20),
        quantidade: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(40),
  cores: z
    .array(
      z.object({
        cor: z.string().trim().min(1).max(60),
        grades: z.number().int().min(1).max(100_000),
      }),
    )
    .min(1)
    .max(60),
});
export type GradeRiscoDto = z.infer<typeof gradeRiscoSchema>;

export const criarOpSchema = simularOpSchema.extend({
  prazo: z.coerce.date().nullable().optional(),
  observacoes: textoOpcional(1000),
  gradeRisco: gradeRiscoSchema.nullable().optional(),
});
export type CriarOpDto = z.infer<typeof criarOpSchema>;

/** Insumo com cores vai com a cor (`insumoCorId`); a mesma cor não repete. */
const consumoSchema = z
  .array(
    z.object({
      insumoId: id,
      insumoCorId: id.nullable().optional(),
      quantidade: z.number().positive().max(1_000_000),
    }),
  )
  .max(100)
  .refine(
    (xs) => new Set(xs.map((x) => `${x.insumoId}|${x.insumoCorId ?? ''}`)).size === xs.length,
    'Insumo repetido (mesma cor)',
  );

/** Corte: tecido realmente gasto e peças cortadas por variação. */
export const corteSchema = z.object({
  tecidos: consumoSchema,
  itens: z
    .array(z.object({ produtoId: id, cortada: z.number().int().min(0).max(100_000) }))
    .min(1)
    .refine(semRepetir, 'Variação repetida'),
  /** Custo do corte DE FATO (Léo, 20/10). Ausente = peças cortadas × valor da empresa. */
  custoCorte: z.number().nonnegative().max(1_000_000).optional(),
  /** Frete de produção desta OP. Ausente = peças cortadas × valor por peça da empresa. */
  custoFrete: z.number().nonnegative().max(1_000_000).optional(),
});
export type CorteDto = z.infer<typeof corteSchema>;

/** Corrigir custo de corte/frete depois do corte (até fechar a OP). */
export const custosOpSchema = z
  .object({
    custoCorte: z.number().nonnegative().max(1_000_000).optional(),
    custoFrete: z.number().nonnegative().max(1_000_000).optional(),
  })
  .refine((d) => d.custoCorte !== undefined || d.custoFrete !== undefined, 'Nada pra mudar');
export type CustosOpDto = z.infer<typeof custosOpSchema>;

/** Envio pra facção: peças enviadas, aviamentos que saíram e o preço por peça. */
export const envioSchema = z.object({
  faccaoId: id,
  /** Vazio = usa a tabela da facção pra este modelo. */
  precoPorPeca: z.number().nonnegative().max(100_000).nullable().optional(),
  itens: z
    .array(z.object({ produtoId: id, enviada: z.number().int().min(0).max(100_000) }))
    .min(1)
    .refine(semRepetir, 'Variação repetida'),
  aviamentos: consumoSchema,
  prazo: z.coerce.date().nullable().optional(),
});
export type EnvioDto = z.infer<typeof envioSchema>;

/** Uma entrega da facção (pode haver várias). */
export const recebimentoSchema = z.object({
  itens: z
    .array(
      z.object({
        produtoId: id,
        quantidade: z.number().int().min(0).max(100_000),
        defeito: z.number().int().min(0).max(100_000).default(0),
      }),
    )
    .min(1)
    .refine(semRepetir, 'Variação repetida')
    .refine((xs) => xs.some((x) => x.quantidade + x.defeito > 0), 'Nenhuma peça nesta entrega'),
});
export type RecebimentoDto = z.infer<typeof recebimentoSchema>;
