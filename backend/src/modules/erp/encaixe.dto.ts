import { z } from 'zod';

/** Encaixe automático (risco) da OP — pedido do usuário e respostas do agente. */

/** Papel útil do plotter da Ribelt (Léo, 07/10): o risco tem que caber nisto. */
export const LARGURA_PLOTTER_MM = 1850;

export const TIPOS_ARQUIVO_ENCAIXE = ['PREVIEW', 'PNG', 'PLT', 'DXF'] as const;
export type TipoArquivoEncaixe = (typeof TIPOS_ARQUIVO_ENCAIXE)[number];

/** O que vai NO risco: quantas peças de cada tamanho da grade (ex.: 1 de cada). */
export const criarEncaixeSchema = z.object({
  modeloLinhaId: z.string().min(1).max(40),
  composicao: z
    .array(
      z.object({
        tamanho: z.string().trim().min(1).max(20),
        quantidade: z.number().int().min(1).max(50),
      }),
    )
    .min(1, 'Escolha ao menos um tamanho pro risco')
    .max(40)
    .refine((xs) => new Set(xs.map((x) => x.tamanho)).size === xs.length, 'Tamanho repetido'),
  /** Quanto tempo a GPU pode procurar um risco melhor. */
  tempoMin: z.number().int().min(2).max(180),
});
export type CriarEncaixeDto = z.infer<typeof criarEncaixeSchema>;

const numeroOpcional = z.number().finite().nonnegative().max(1_000_000).nullable().optional();
/** Imagem PNG em base64 (sem o prefixo data:). */
const pngBase64 = z
  .string()
  .max(14_000_000)
  .regex(/^[A-Za-z0-9+/=\s]+$/, 'base64 inválido');

/** O agente conta o melhor que achou até agora (e manda a imagem dele). */
export const progressoEncaixeSchema = z.object({
  comprimentoM: numeroOpcional,
  aproveitamento: numeroOpcional,
  iteracoes: z.number().int().nonnegative().max(1e12).nullable().optional(),
  imagemPng: pngBase64.nullable().optional(),
});
export type ProgressoEncaixeDto = z.infer<typeof progressoEncaixeSchema>;

/** O agente entrega: números, o .plt (HPGL em texto) e as imagens. */
export const resultadoEncaixeSchema = z.object({
  comprimentoM: z.number().finite().positive().max(1000),
  aproveitamento: z.number().finite().min(0).max(100),
  /** HPGL em texto, como o TEXWARE lê (começa com IN/NE…). */
  plt: z.string().min(10).max(15_000_000),
  imagemPng: pngBase64.nullable().optional(),
  dxf: z.string().max(15_000_000).nullable().optional(),
  /** O que mais o agente quiser registrar (posições, tempo gasto…). */
  detalhes: z.record(z.unknown()).nullable().optional(),
});
export type ResultadoEncaixeDto = z.infer<typeof resultadoEncaixeSchema>;

export const falhaEncaixeSchema = z.object({
  erro: z.string().trim().min(1).max(2000),
});
export type FalhaEncaixeDto = z.infer<typeof falhaEncaixeSchema>;
