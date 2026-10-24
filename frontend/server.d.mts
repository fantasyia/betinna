/** Tipos do servidor do front (server.mjs) — só pros testes em TS. */
import type { Server } from 'node:http';

export interface MarcaPreview {
  nome: string;
  dominio: string | null;
  tituloApp?: string | null;
  descricao?: string | null;
  imagemCompartilhamento?: string | null;
  logoUrl?: string | null;
  vitrineSlug?: string | null;
}

export function cacheDe(rel: string): string | null;
export function normalizarHost(h: string | undefined | null): string;
export function aplicarMarca(
  html: string,
  marca: MarcaPreview | null,
  ctx: { host: string; caminho: string },
): string;
export interface PoliticaPrivacidade {
  titulo: string;
  marca: string;
  atualizadaEm: string;
  secoes: Array<{ titulo: string; paragrafos: string[]; itens?: string[] }>;
}
export function slugDaPrivacidade(
  caminho: string,
  marca: MarcaPreview | null,
  doTenant: boolean,
): string | null;
export function paginaPrivacidade(p: PoliticaPrivacidade, opts: { voltar: string }): string;
export function produtoDaRota(
  caminho: string,
  marca: MarcaPreview | null,
  doTenant: boolean,
): { vitrine: string; produto: string } | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModeloPub = any;
export function faixaDePreco(modelo: ModeloPub): { min: number; max: number } | null;
export function seoDoProduto(
  modelo: ModeloPub,
  vitrine: ModeloPub,
  ctx: { base: string; caminho: string },
): {
  titulo: string;
  descricao: string;
  url: string;
  imagem: string | null;
  jsonLd: Record<string, unknown>;
  palavras: string[];
};
export function aplicarProduto(html: string, seo: ReturnType<typeof seoDoProduto>): string;
export function sitemapXml(vitrine: ModeloPub, base: string): string;
export function robotsDaVitrine(base: string): string;
export function criarServidor(opts: {
  dist: string;
  apiUrl: string;
  fetchFn?: typeof fetch;
  ttlMs?: number;
  sites?: string | null;
}): Server;
export function arquivoDoSite(
  sitesDir: string | null,
  host: string | undefined,
  caminho: string,
): Promise<{ pasta: string; noindex: boolean; alvo: string | null } | null>;
