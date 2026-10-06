/**
 * Estoque por variação → grade pra tela: modelo → linha → cores (linhas da
 * tabela) × tamanhos (colunas). PURO (testado).
 */

export interface SaldoVariacao {
  produtoId: string;
  ativo: boolean;
  modelo: { id: string; nome: string; ordem: number };
  cor: { nome: string; hex: string; ordem: number };
  linha: { nome: string; ordem: number };
  tamanho: { nome: string; ordem: number };
  fisico: number;
  reservado: number;
  disponivel: number;
}

export interface Celula {
  produtoId: string;
  fisico: number;
  reservado: number;
  disponivel: number;
  ativo: boolean;
}

export interface GradeLinha {
  linha: string;
  tamanhos: string[];
  cores: Array<{ nome: string; hex: string; celulas: Array<Celula | null> }>;
}

export interface GradeModelo {
  id: string;
  nome: string;
  fisico: number;
  reservado: number;
  disponivel: number;
  linhas: GradeLinha[];
}

const porOrdem = <T extends { ordem: number; nome: string }>(a: T, b: T) =>
  a.ordem - b.ordem || a.nome.localeCompare(b.nome);

export function montarGrade(vs: SaldoVariacao[]): GradeModelo[] {
  const modelos = new Map<string, { m: SaldoVariacao['modelo']; vs: SaldoVariacao[] }>();
  for (const v of vs) {
    const g = modelos.get(v.modelo.id) ?? { m: v.modelo, vs: [] };
    g.vs.push(v);
    modelos.set(v.modelo.id, g);
  }
  return [...modelos.values()]
    .sort((a, b) => porOrdem(a.m, b.m))
    .map(({ m, vs: dele }) => {
      const linhasNomes = uniq(dele.map((v) => v.linha)).sort(porOrdem);
      return {
        id: m.id,
        nome: m.nome,
        fisico: soma(dele, 'fisico'),
        reservado: soma(dele, 'reservado'),
        disponivel: soma(dele, 'disponivel'),
        linhas: linhasNomes.map((l) => {
          const daLinha = dele.filter((v) => v.linha.nome === l.nome);
          const tamanhos = uniq(daLinha.map((v) => v.tamanho)).sort(porOrdem);
          const cores = uniq(daLinha.map((v) => ({ ...v.cor }))).sort(porOrdem);
          return {
            linha: l.nome,
            tamanhos: tamanhos.map((t) => t.nome),
            cores: cores.map((c) => ({
              nome: c.nome,
              hex: c.hex,
              celulas: tamanhos.map((t) => {
                const v = daLinha.find((x) => x.cor.nome === c.nome && x.tamanho.nome === t.nome);
                return v
                  ? { produtoId: v.produtoId, fisico: v.fisico, reservado: v.reservado, disponivel: v.disponivel, ativo: v.ativo }
                  : null;
              }),
            })),
          };
        }),
      };
    });
}

function uniq<T extends { nome: string }>(xs: T[]): T[] {
  const m = new Map<string, T>();
  for (const x of xs) if (!m.has(x.nome)) m.set(x.nome, x);
  return [...m.values()];
}

function soma(vs: SaldoVariacao[], k: 'fisico' | 'reservado' | 'disponivel'): number {
  return vs.reduce((s, v) => s + v[k], 0);
}
