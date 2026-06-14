import { z } from 'zod';

export const PERIODOS = ['mes', 'trimestre', 'semestre', 'ano'] as const;

/**
 * Parâmetros de período compartilhados por todos os endpoints.
 *
 * Precedência: `periodo` > `de`+`ate` > default (mês atual).
 * `representanteId` filtra por rep específico (só válido para ADMIN/DIRECTOR/GERENTE).
 * `funilId` (endpoint /funil) seleciona um funil customizado — o snapshot passa a
 * usar as etapas dele (nome/cor/ordem) em vez do enum LeadEtapa legado.
 */
export const periodoSchema = z
  .object({
    de: z.coerce.date().optional(),
    ate: z.coerce.date().optional(),
    periodo: z.enum(PERIODOS).optional(),
    representanteId: z.string().cuid().optional(),
    funilId: z.string().cuid().optional(),
  })
  .refine((d) => !d.de || !d.ate || d.de <= d.ate, {
    message: 'Data inicial (de) deve ser <= data final (ate)',
  })
  .transform((d) => {
    if (d.periodo) {
      const agora = new Date();
      let de: Date;
      switch (d.periodo) {
        case 'mes':
          de = new Date(agora.getFullYear(), agora.getMonth(), 1);
          break;
        case 'trimestre':
          de = new Date(agora.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case 'semestre':
          de = new Date(agora.getTime() - 180 * 24 * 60 * 60 * 1000);
          break;
        case 'ano':
          de = new Date(agora.getFullYear(), 0, 1);
          break;
      }
      return { ...d, de, ate: agora };
    }
    const agora = new Date();
    return {
      ...d,
      de: d.de ?? new Date(agora.getFullYear(), agora.getMonth(), 1),
      ate: d.ate ?? agora,
    };
  });

export type PeriodoDto = z.infer<typeof periodoSchema>;
