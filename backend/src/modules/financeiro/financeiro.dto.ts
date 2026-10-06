import { z } from 'zod';

/** ERP próprio · Fase 3 — contas a pagar e a receber (sem NF-e). */

const id = z.string().min(1).max(40);
const tipo = z.enum(['RECEBER', 'PAGAR']);
/** Data sem hora, "AAAA-MM-DD". */
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const dinheiro = z.number().positive('Valor maior que zero').max(100_000_000);
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const FORMAS = ['PIX', 'CARTAO', 'BOLETO', 'DINHEIRO', 'TRANSFERENCIA', 'OUTRA'] as const;

export const listarTitulosSchema = z.object({
  tipo,
  /** ABERTO inclui PARCIAL; VENCIDO = aberto com vencimento no passado. */
  situacao: z.enum(['ABERTO', 'VENCIDO', 'QUITADO', 'CANCELADO', 'TODOS']).default('ABERTO'),
  de: data.optional(),
  ate: data.optional(),
  categoriaId: id.optional(),
  busca: z.string().trim().max(100).optional(),
});
export type ListarTitulosDto = z.infer<typeof listarTitulosSchema>;

export const tituloSchema = z.object({
  tipo,
  descricao: z.string().trim().min(2, 'Descreva o lançamento').max(200),
  valor: dinheiro,
  vencimento: data,
  categoriaId: id.nullable().optional(),
  contatoNome: textoOpcional(120),
  observacoes: textoOpcional(1000),
  /** Parcelar em N meses (o valor é POR parcela). 1 = sem parcelar. */
  parcelas: z.number().int().min(1).max(60).default(1),
});
export type TituloDto = z.infer<typeof tituloSchema>;

export const editarTituloSchema = tituloSchema.omit({ tipo: true, parcelas: true });
export type EditarTituloDto = z.infer<typeof editarTituloSchema>;

export const baixaSchema = z.object({
  valor: dinheiro,
  data,
  contaId: id,
  forma: z.enum(FORMAS).nullable().optional(),
  observacao: textoOpcional(300),
});
export type BaixaDto = z.infer<typeof baixaSchema>;

/** Baixa em massa: cada título quitado pelo saldo que falta. */
export const baixaEmMassaSchema = z.object({
  ids: z.array(id).min(1).max(500),
  data,
  contaId: id,
  forma: z.enum(FORMAS).nullable().optional(),
});
export type BaixaEmMassaDto = z.infer<typeof baixaEmMassaSchema>;

export const categoriaSchema = z.object({
  tipo,
  nome: z.string().trim().min(2).max(60),
  ativo: z.boolean().optional(),
});
export type CategoriaDto = z.infer<typeof categoriaSchema>;

export const contaSchema = z.object({
  nome: z.string().trim().min(2).max(60),
  tipo: z.enum(['BANCO', 'ASAAS', 'DINHEIRO', 'OUTRA']),
  saldoInicial: z.number().min(-100_000_000).max(100_000_000).default(0),
  ativo: z.boolean().optional(),
});
export type ContaDto = z.infer<typeof contaSchema>;

export const recorrenciaSchema = z.object({
  tipo,
  descricao: z.string().trim().min(2).max(200),
  valor: dinheiro,
  dia: z.number().int().min(1).max(31),
  categoriaId: id.nullable().optional(),
  contatoNome: textoOpcional(120),
  ativo: z.boolean().optional(),
});
export type RecorrenciaDto = z.infer<typeof recorrenciaSchema>;
