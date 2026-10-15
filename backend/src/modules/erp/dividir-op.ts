/**
 * Dividir a OP em 2 (Léo, 14/10): risco acima do ideal de 6 m vira duas OPs
 * pela METADE da grade. Sobra de quantidade ímpar fica na A. PURO.
 *
 * - OP montada pela grade do risco: divide a COMPOSIÇÃO (2M 2G 1GG → A 1M 1G
 *   1GG · B 1M 1G) e mantém as folhas (grades) de cada cor nas duas — peças da
 *   variação = metade da composição × folhas da cor.
 * - Sem grade do risco (ou linha fora dela): divide variação por variação.
 */

export interface ItemParaDividir {
  produtoId: string;
  linha: string;
  cor: string;
  tamanho: string;
  planejada: number;
}

export interface GradeRiscoOp {
  linha: string;
  composicao: Array<{ tamanho: string; quantidade: number }>;
  cores: Array<{ cor: string; grades: number }>;
}

export interface Divisao {
  a: Map<string, number>;
  b: Map<string, number>;
  riscoA: GradeRiscoOp | null;
  riscoB: GradeRiscoOp | null;
}

const metade = (q: number) => ({ a: Math.ceil(q / 2), b: Math.floor(q / 2) });

export function dividirOp(itens: ItemParaDividir[], risco: GradeRiscoOp | null): Divisao {
  const a = new Map<string, number>();
  const b = new Map<string, number>();
  let riscoA: GradeRiscoOp | null = null;
  let riscoB: GradeRiscoOp | null = null;
  const compA = new Map<string, number>();
  const compB = new Map<string, number>();
  const folhas = new Map<string, number>();
  if (risco) {
    for (const c of risco.composicao) {
      const m = metade(c.quantidade);
      compA.set(c.tamanho, m.a);
      compB.set(c.tamanho, m.b);
    }
    for (const c of risco.cores) folhas.set(c.cor, c.grades);
    const comp = (m: Map<string, number>) =>
      risco.composicao
        .map((c) => ({ tamanho: c.tamanho, quantidade: m.get(c.tamanho) ?? 0 }))
        .filter((c) => c.quantidade > 0);
    riscoA = { ...risco, composicao: comp(compA) };
    riscoB = { ...risco, composicao: comp(compB) };
  }
  for (const i of itens) {
    const pelaGrade = risco && i.linha === risco.linha && folhas.has(i.cor) && compA.has(i.tamanho);
    if (pelaGrade) {
      const f = folhas.get(i.cor)!;
      a.set(i.produtoId, (compA.get(i.tamanho) ?? 0) * f);
      b.set(i.produtoId, (compB.get(i.tamanho) ?? 0) * f);
    } else {
      const m = metade(i.planejada);
      a.set(i.produtoId, m.a);
      b.set(i.produtoId, m.b);
    }
  }
  return { a, b, riscoA, riscoB: riscoB && riscoB.composicao.length ? riscoB : null };
}
