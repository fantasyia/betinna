import type { CosturaDto } from './fichas.dto';

/**
 * Ficha de costura (#03 Modelista, 01/11) — regras PURAS. Mora em
 * FichaTecnica.costura; as imagens ficam no bucket da vitrine (pasta `costura/`).
 */

export interface ImagemCostura {
  id: string;
  path: string;
  legenda: string | null;
}

export type Costura = Omit<CosturaDto, 'imagens'> & {
  imagens: ImagemCostura[];
  atualizadoEm: string;
};

export const MAX_IMAGENS_COSTURA = 8;

/** O que está gravado (ou ficha sem costura ainda). */
export function costuraGravada(v: unknown): Costura | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Partial<Costura>;
  return {
    imagens: c.imagens ?? [],
    pecasCorte: c.pecasCorte ?? [],
    sequencia: c.sequencia ?? [],
    etiquetas: c.etiquetas ?? [],
    atencao: c.atencao ?? [],
    medidas: c.medidas ?? [],
    atualizadoEm: c.atualizadoEm ?? '',
  };
}

export function costuraVazia(): Costura {
  return {
    imagens: [],
    pecasCorte: [],
    sequencia: [],
    etiquetas: [],
    atencao: [],
    medidas: [],
    atualizadoEm: new Date().toISOString(),
  };
}

/** Tamanhos das medidas que não são da grade (recusa ao salvar). */
export function medidasForaDaGrade(medidas: CosturaDto['medidas'], grade: string[]): string[] {
  const daGrade = new Set(grade);
  return [...new Set(medidas.flatMap((m) => Object.keys(m.valores)))].filter(
    (t) => !daGrade.has(t),
  );
}

/**
 * Nova ordem/legenda das imagens. Id que não existe ESTOURA (não inventa
 * imagem); id que sumiu da lista é apagado do bucket.
 */
export function aplicarImagens(
  atuais: ImagemCostura[],
  pedidas: CosturaDto['imagens'],
): { imagens: ImagemCostura[]; removidas: string[] } {
  const porId = new Map(atuais.map((i) => [i.id, i]));
  const vistos = new Set<string>();
  const imagens = pedidas.map((p) => {
    const i = porId.get(p.id);
    if (!i) throw new Error(`Imagem ${p.id} não existe nesta ficha de costura`);
    if (vistos.has(p.id)) throw new Error(`Imagem ${p.id} repetida`);
    vistos.add(p.id);
    return { ...i, legenda: p.legenda ?? null };
  });
  return { imagens, removidas: atuais.filter((i) => !vistos.has(i.id)).map((i) => i.path) };
}

/**
 * Bloco "NÃO é da oficina" (#03): os serviços de acabamento da grade, com os
 * tamanhos onde valem (capuz infantil 2–6 sem cordão). `tamanhos` null = todos.
 */
export function foraDaOficina(
  servicos: Array<{ id: string; nome: string }>,
  acabamentoTamanhos: unknown,
): Array<{ nome: string; tamanhos: string[] | null }> {
  const restr =
    acabamentoTamanhos && typeof acabamentoTamanhos === 'object'
      ? (acabamentoTamanhos as Record<string, string[]>)
      : {};
  return servicos.map((s) => ({
    nome: s.nome,
    tamanhos: Array.isArray(restr[s.id]) ? restr[s.id] : null,
  }));
}
