import { z } from 'zod';

/**
 * Conteúdo pros robôs das IAs e do Google (card GEO cmvkab9gl, 23/10): título
 * da vitrine, "quem somos", perguntas frequentes e redes. Mora em
 * `Empresa.config.geo` (quem mantém é a sessão de ads/#04, pelo MCP, com o OK
 * do Léo). O servidor do front transforma isso em HTML, JSON-LD e llms.txt. PURO.
 */
export interface ConfigGeo {
  /** <title> da vitrine (ex.: "Ribelt Têxtil · Atacado de roupa masculina"). */
  titulo?: string | null;
  /** Parágrafo "quem somos" (texto puro). */
  sobre?: string | null;
  faq?: Array<{ pergunta: string; resposta: string }>;
  /** Perfis oficiais (Instagram, YouTube…) — `sameAs` do JSON-LD. */
  redes?: string[];
}

export function configGeo(config: unknown): ConfigGeo {
  const g = ((config ?? {}) as { geo?: ConfigGeo }).geo ?? {};
  return {
    titulo: typeof g.titulo === 'string' && g.titulo.trim() ? g.titulo.trim() : null,
    sobre: typeof g.sobre === 'string' && g.sobre.trim() ? g.sobre.trim() : null,
    faq: Array.isArray(g.faq)
      ? g.faq.filter((x) => x && typeof x.pergunta === 'string' && typeof x.resposta === 'string')
      : [],
    redes: Array.isArray(g.redes) ? g.redes.filter((x) => typeof x === 'string') : [],
  };
}

export const geoConfigSchema = z.object({
  titulo: z.string().trim().max(120).nullable().optional(),
  sobre: z.string().trim().max(2000).nullable().optional(),
  faq: z
    .array(
      z.object({
        pergunta: z.string().trim().min(3).max(200),
        resposta: z.string().trim().min(1).max(2000),
      }),
    )
    .max(40)
    .optional(),
  redes: z.array(z.string().trim().url().max(200)).max(10).optional(),
});
export type GeoConfigDto = z.infer<typeof geoConfigSchema>;
