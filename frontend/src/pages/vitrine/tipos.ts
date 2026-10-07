/** Vitrine de atacado — tipos do cadastro (espelham /vitrine/admin/*). */

export interface VitrineConfig {
  id: string;
  slug: string;
  ativa: boolean;
  minimoEntrada: number | null;
  minimoVolume: number | null;
  minimoAtacadao: number | null;
  respeitaEstoque?: boolean;
}

export interface Cor {
  id: string;
  nome: string;
  hex: string;
  ordem: number;
  ativo: boolean;
}

export interface Categoria {
  id: string;
  nome: string;
  ordem: number;
  ativo: boolean;
  _count?: { modelos: number };
}

export interface Tamanho {
  id: string;
  nome: string;
  ordem: number;
  ativo: boolean;
}

export interface Linha {
  id: string;
  nome: string;
  ordem: number;
  ativo: boolean;
  /** Selo da linha na vitrine (Plus Size de verdade…). */
  selo?: string | null;
  tamanhos: Tamanho[];
}

export interface Foto {
  id: string;
  ordem: number;
  url: string | null;
  thumbUrl: string | null;
  largura: number | null;
  altura: number | null;
  /** Linha (biotipo) da foto; null = foto geral da cor, vale pra todas as linhas. */
  linhaId?: string | null;
}

export interface Video {
  id: string;
  ordem: number;
  url: string | null;
  nomeArquivo: string | null;
  tamanhoBytes: number | null;
}

export interface TabelaMedidas {
  colunas: string[];
  linhas: Array<{ tamanho: string; valores: string[] }>;
}

/** Decimal chega como number (ResponseInterceptor) ou string — normalizar na tela. */
type Dinheiro = number | string | null;

export interface ModeloLinha {
  id: string;
  linhaId: string;
  precoEntrada: Dinheiro;
  precoVolume: Dinheiro;
  precoAtacadao: Dinheiro;
  precoSugerido: Dinheiro;
  tabelaMedidas: TabelaMedidas | null;
  linha: Linha;
  tamanhos: Array<{ id: string; tamanhoId: string; tamanho: Tamanho }>;
}

export interface ModeloCor {
  id: string;
  corId: string;
  ordem: number;
  /** Ponto da capa que vira a bolinha na vitrine (0–1). null = automático. */
  amostraX?: number | null;
  amostraY?: number | null;
  cor: Cor;
  fotos: Foto[];
}

export interface Modelo {
  id: string;
  nome: string;
  categoriaId: string | null;
  categoria: { id: string; nome: string } | null;
  descricao: string | null;
  etiquetas: string[];
  ordem: number;
  ativo: boolean;
  tituloMarketplace: string | null;
  descricaoMarketplace: string | null;
  composicao: string | null;
  cores: ModeloCor[];
  linhas: ModeloLinha[];
  videos: Video[];
  variacoes: Array<{
    id: string;
    modeloCorId: string;
    modeloTamanhoId: string;
    sku: string | null;
    estoque: number | null;
  }>;
}

export function dinheiroParaNumero(v: Dinheiro): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
