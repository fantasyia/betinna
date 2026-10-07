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
export function criarServidor(opts: {
  dist: string;
  apiUrl: string;
  fetchFn?: typeof fetch;
  ttlMs?: number;
}): Server;
