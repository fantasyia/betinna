import { z } from 'zod';

export const META_TIPO = ['FATURAMENTO', 'PEDIDOS'] as const;
export const META_ALVO_TIPO = ['EMPRESA', 'REP', 'GERENTE'] as const;
export const META_PERIODO = ['MES', 'TRIMESTRE', 'ANO'] as const;

export const upsertMetaSchema = z
  .object({
    titulo: z.string().trim().min(2).max(200),
    descricao: z.string().trim().max(1000).nullable().optional(),
    tipo: z.enum(META_TIPO).default('FATURAMENTO'),
    valorAlvo: z.number().min(0),
    alvoTipo: z.enum(META_ALVO_TIPO).default('REP'),
    alvoId: z.string().cuid().nullable().optional(),
    periodicidade: z.enum(META_PERIODO).default('MES'),
    inicio: z.string().datetime(),
    fim: z.string().datetime(),
    ativo: z.boolean().default(true),
  })
  .refine((d) => new Date(d.inicio) < new Date(d.fim), {
    message: 'Início deve ser anterior ao fim',
  })
  .refine((d) => (d.alvoTipo === 'EMPRESA' ? true : !!d.alvoId), {
    message: 'alvoId obrigatório quando alvoTipo é REP ou GERENTE',
  });
export type UpsertMetaDto = z.infer<typeof upsertMetaSchema>;
