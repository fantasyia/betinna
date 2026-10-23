import { z } from 'zod';

/**
 * Microsoft Clarity na vitrine (card cmvk9lwrp — #04/Léo, 22/10): gravação de
 * sessão e mapa de calor. O ID do projeto é público (vai na página); fica em
 * `Empresa.config.clarity`, igual ao pixel e à tag do Google. PURO.
 */
export interface ConfigClarity {
  ativo?: boolean;
  projetoId?: string | null;
}

export function configClarity(config: unknown): ConfigClarity {
  return (((config ?? {}) as Record<string, unknown>).clarity ?? {}) as ConfigClarity;
}

/** O que a vitrine pública recebe. null = desligado ou sem ID. */
export function clarityLigado(config: unknown): { projetoId: string } | null {
  const c = configClarity(config);
  return c.ativo === true && c.projetoId ? { projetoId: c.projetoId } : null;
}

export const clarityConfigSchema = z
  .object({
    ativo: z.boolean(),
    projetoId: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9]{6,20}$/, 'ID do projeto do Clarity: letras e números (ex.: z1z4fnaulg)')
        .nullable()
        .optional(),
    ),
  })
  .refine((d) => !d.ativo || !!d.projetoId, {
    path: ['projetoId'],
    message: 'Informe o ID do projeto pra ligar',
  });
export type ClarityConfigDto = z.infer<typeof clarityConfigSchema>;
