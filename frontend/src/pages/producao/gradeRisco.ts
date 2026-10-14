import type { CelulaGrade, ValoresGrade } from './GradeEditor';

/**
 * OP pela GRADE DO RISCO (Léo, 14/10): escolhe a linha e a grade ("2M 2G 1GG"),
 * adiciona as cores e quantas grades de cada uma. Peças = grade × grades da cor
 * (no tubular, 1 grade = 1 folha do enfesto — #03 Modelista). Uma grade por OP,
 * uma linha por grade (decisão do Léo). Tudo PURO.
 */

export interface CorDaGrade {
  cor: string;
  grades: number;
}

/** O que vai junto da OP (e volta preenchido no "Gerar risco"). */
export interface GradeRisco {
  linha: string;
  composicao: Array<{ tamanho: string; quantidade: number }>;
  cores: CorDaGrade[];
}

export interface LinhaDoModelo {
  linha: string;
  tamanhos: string[];
  cores: Array<{ nome: string; hex: string }>;
}

/** Linhas do modelo, cada uma com os tamanhos e as cores, na ordem do cadastro. */
export function linhasDoModelo(celulas: CelulaGrade[]): LinhaDoModelo[] {
  const por = new Map<
    string,
    { ordem: number; tam: Map<string, number>; cores: Map<string, { hex: string; ordem: number }> }
  >();
  for (const c of celulas) {
    const g = por.get(c.linha) ?? { ordem: c.linhaOrdem, tam: new Map(), cores: new Map() };
    g.tam.set(c.tamanho, c.tamanhoOrdem);
    g.cores.set(c.cor.nome, { hex: c.cor.hex, ordem: c.corOrdem });
    por.set(c.linha, g);
  }
  return [...por.entries()]
    .sort((a, b) => a[1].ordem - b[1].ordem)
    .map(([linha, g]) => ({
      linha,
      tamanhos: [...g.tam.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t),
      cores: [...g.cores.entries()]
        .sort((a, b) => a[1].ordem - b[1].ordem)
        .map(([nome, x]) => ({ nome, hex: x.hex })),
    }));
}

/** Peças que saem de UMA grade (2M 2G 1GG = 5). */
export const pecasPorGrade = (composicao: Record<string, number>) =>
  Object.values(composicao).reduce((s, n) => s + (n > 0 ? n : 0), 0);

/**
 * Quantidade de cada variação da OP: tamanho × grades da cor, só na linha
 * escolhida. Vira o mesmo `ValoresGrade` do modo peça por peça — a OP, a
 * simulação e o custo não mudam nada.
 */
export function quantidadesDaGrade(
  celulas: CelulaGrade[],
  linha: string,
  composicao: Record<string, number>,
  cores: CorDaGrade[],
): ValoresGrade {
  const grades = new Map(cores.filter((c) => c.grades > 0).map((c) => [c.cor, c.grades]));
  const out: ValoresGrade = {};
  for (const c of celulas) {
    if (c.linha !== linha) continue;
    const n = (composicao[c.tamanho] ?? 0) * (grades.get(c.cor.nome) ?? 0);
    if (n > 0) out[c.produtoId] = String(n);
  }
  return out;
}

/** O registro da grade que vai junto da OP (null = grade incompleta). */
export function registroDaGrade(
  linha: string,
  tamanhos: string[],
  composicao: Record<string, number>,
  cores: CorDaGrade[],
): GradeRisco | null {
  const comp = tamanhos
    .map((t) => ({ tamanho: t, quantidade: composicao[t] ?? 0 }))
    .filter((c) => c.quantidade > 0);
  const cs = cores.filter((c) => c.grades > 0);
  if (!linha || !comp.length || !cs.length) return null;
  return { linha, composicao: comp, cores: cs };
}

/** "2M 2G 1GG" — pra mostrar a grade em uma linha. */
export const textoDaGrade = (composicao: Array<{ tamanho: string; quantidade: number }>) =>
  composicao.map((c) => `${c.quantidade}${c.tamanho}`).join(' ');
