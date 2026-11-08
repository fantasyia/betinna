import { z } from 'zod';

/**
 * Selo do Reclame Aqui no rodapé da vitrine (Léo, 06-07/11). O código vem do
 * painel do Reclame Aqui (área da empresa → compartilhar selo): um `data-id`
 * público e o modelo escolhido. Fica em `Empresa.config.seloReclameAqui`,
 * igual ao Clarity. PURO.
 */
export const MODELOS_SELO_RA = [
  'compact_1',
  'compact_2',
  'compact_3',
  'horizontal_1',
  'horizontal_2',
  'horizontal_3',
] as const;
export type ModeloSeloRa = (typeof MODELOS_SELO_RA)[number];

export interface ConfigSeloRa {
  ativo?: boolean;
  dataId?: string | null;
  modelo?: ModeloSeloRa | null;
}

export function configSeloRa(config: unknown): ConfigSeloRa {
  return (((config ?? {}) as Record<string, unknown>).seloReclameAqui ?? {}) as ConfigSeloRa;
}

const DATA_ID = /^[A-Za-z0-9+/=_-]{8,200}$/;

/** O que a vitrine pública recebe. null = desligado ou incompleto. */
export function seloRaLigado(config: unknown): { dataId: string; modelo: ModeloSeloRa } | null {
  const c = configSeloRa(config);
  if (c.ativo !== true || !c.dataId || !DATA_ID.test(c.dataId)) return null;
  const modelo = MODELOS_SELO_RA.includes(c.modelo as ModeloSeloRa)
    ? (c.modelo as ModeloSeloRa)
    : 'compact_1';
  return { dataId: c.dataId, modelo };
}

export const seloRaConfigSchema = z
  .object({
    ativo: z.boolean(),
    dataId: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z
        .string()
        .trim()
        .regex(DATA_ID, 'Cole o data-id do código do selo (letras, números, = e /)')
        .nullable()
        .optional(),
    ),
    modelo: z.enum(MODELOS_SELO_RA).default('compact_1'),
  })
  .refine((d) => !d.ativo || !!d.dataId, {
    path: ['dataId'],
    message: 'Informe o data-id do selo pra ligar',
  });
export type SeloRaConfigDto = z.infer<typeof seloRaConfigSchema>;
