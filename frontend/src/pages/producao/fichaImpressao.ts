/**
 * Contas da ficha da OP impressa (card cmv8po94p0089pf5ih9l3n8bn, Léo 14/10). PURO.
 */

export interface ItemGrade {
  modeloLinhaId: string;
  linha: string;
  linhaOrdem: number;
  cor: string;
  corOrdem: number;
  tamanho: string;
  tamanhoOrdem: number;
  planejada: number;
}

/** Grade cor × tamanho: tamanhos na ordem e uma linha por (grade, cor). */
export function gradeCorTamanho(itens: ItemGrade[]) {
  const tam = new Map<string, number>();
  for (const i of itens) tam.set(i.tamanho, Math.min(tam.get(i.tamanho) ?? 1e9, i.linhaOrdem * 1000 + i.tamanhoOrdem));
  const tamanhos = [...tam.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t);
  const linhas = new Map<string, { linha: string; cor: string; ordem: number; porTam: Record<string, number>; total: number }>();
  for (const i of itens) {
    if (i.planejada <= 0) continue;
    const k = `${i.modeloLinhaId}|${i.cor}`;
    const l = linhas.get(k) ?? { linha: i.linha, cor: i.cor, ordem: i.linhaOrdem * 1000 + i.corOrdem, porTam: {}, total: 0 };
    l.porTam[i.tamanho] = (l.porTam[i.tamanho] ?? 0) + i.planejada;
    l.total += i.planejada;
    linhas.set(k, l);
  }
  const rows = [...linhas.values()].sort((a, b) => a.ordem - b.ordem);
  const totalPorTam = Object.fromEntries(tamanhos.map((t) => [t, rows.reduce((s, r) => s + (r.porTam[t] ?? 0), 0)]));
  return { tamanhos, linhas: rows, totalPorTam, total: rows.reduce((s, r) => s + r.total, 0) };
}

/**
 * Total de um item da ficha pra OP (o que mandar pra facção/acabamento):
 * Σ peças do tamanho × quantidade daquele tamanho (porTamanho), senão o médio.
 */
export function totalDoItem(
  item: { consumoPorPeca: number; porTamanho: Record<string, number> | null },
  pecasPorTamanho: Record<string, number>,
): number {
  return Object.entries(pecasPorTamanho).reduce(
    (s, [t, q]) => s + q * (item.porTamanho?.[t] ?? item.consumoPorPeca),
    0,
  );
}

/** Peças por tamanho só das grades da ficha (Regular, Plus…). */
export function pecasPorTamanho(itens: ItemGrade[], modeloLinhaId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of itens) if (i.modeloLinhaId === modeloLinhaId && i.planejada > 0) out[i.tamanho] = (out[i.tamanho] ?? 0) + i.planejada;
  return out;
}

/**
 * Enfesto por cor: folhas = peças da cor (das grades do risco) ÷ peças do
 * risco; metros = comprimento do risco × folhas (o viés vai FORA disso).
 */
export function enfestoPorCor(
  itens: ItemGrade[],
  risco: { linha: string; composicao: Array<{ linha?: string; quantidade: number }>; comprimentoM: number },
): Array<{ cor: string; folhas: number; metros: number }> {
  const pecasRisco = risco.composicao.reduce((s, c) => s + c.quantidade, 0);
  if (!pecasRisco || !(risco.comprimentoM > 0)) return [];
  const linhas = new Set(risco.composicao.map((c) => c.linha ?? risco.linha));
  const porCor = new Map<string, number>();
  for (const i of itens) {
    if (i.planejada <= 0 || !linhas.has(i.linha)) continue;
    porCor.set(i.cor, (porCor.get(i.cor) ?? 0) + i.planejada);
  }
  return [...porCor.entries()].map(([cor, pecas]) => {
    const folhas = pecas / pecasRisco;
    return { cor, folhas, metros: Math.ceil(risco.comprimentoM * folhas * 100 - 1e-9) / 100 };
  });
}

/** "0,76 m" / "2 un" / "0,121 kg" — quantidade na unidade do insumo. */
export function qtdUn(v: number, unidade: string): string {
  const sig: Record<string, string> = { KG: 'kg', METRO: 'm', UNIDADE: 'un', PAR: 'par' };
  const casas = unidade === 'UNIDADE' || unidade === 'PAR' ? 0 : unidade === 'KG' ? 3 : 2;
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: casas })} ${sig[unidade] ?? unidade.toLowerCase()}`;
}
