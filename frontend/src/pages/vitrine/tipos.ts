/** Vitrine de atacado — tipos do cadastro (espelham /vitrine/admin/*). */

export interface VitrineConfig {
  id: string;
  slug: string;
  ativa: boolean;
  minimoEntrada: number | null;
  minimoVolume: number | null;
  minimoAtacadao: number | null;
  respeitaEstoque?: boolean;
  /** Domínio próprio (branding) — a vitrine abre na raiz dele. null = sem. */
  dominio?: string | null;
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
  /** Entra no rodízio da abertura (cada cliente vê uma das marcadas primeiro). */
  rodizio?: boolean;
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
  /** Observação abaixo da tabela (28/10). */
  nota?: string;
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
  tamanhos: Array<{
    id: string;
    tamanhoId: string;
    /** Peso de UMA peça (g) — monta os volumes do frete. null = não cadastrado. */
    pesoGramas?: number | null;
    tamanho: Tamanho;
  }>;
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
  /** Endereço próprio na vitrine (/p/<slug>, 23/10). Fixo depois de criado. */
  slug?: string | null;
  categoriaId: string | null;
  categoria: { id: string; nome: string } | null;
  descricao: string | null;
  etiquetas: string[];
  ordem: number;
  ativo: boolean;
  tituloMarketplace: string | null;
  descricaoMarketplace: string | null;
  composicao: string | null;
  /** NCM, 8 dígitos sem pontos (24/10). */
  ncm?: string | null;
  /** Resto do fiscal (24/10), vazio = não preenchido. */
  fiscal?: Record<string, string | number | null> | null;
  /** Título pro Google/IAs (23/10); null = o nome. */
  tituloSeo?: string | null;
  /** Palavras SEO (23/10). */
  palavrasSeo?: string[];
  /** Modelos que combinam (conjunto) — ligados a partir DESTE modelo. */
  combinaCom?: string[];
  cores: ModeloCor[];
  linhas: ModeloLinha[];
  videos: Video[];
  variacoes: Array<{
    id: string;
    modeloCorId: string;
    modeloTamanhoId: string;
    sku: string | null;
    /** Código do sistema anterior (22/10) — só no sistema. */
    skuSecundario?: string | null;
    /** EAN-13 (20/10); sem prefixo GS1, faixa interna (começa com 2). */
    ean?: string | null;
    /** Sem código de barras (export "SEM GTIN"). */
    semGtin?: boolean;
    estoque: number | null;
  }>;
}

export function dinheiroParaNumero(v: Dinheiro): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
