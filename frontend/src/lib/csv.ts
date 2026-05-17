/**
 * Utility para gerar e baixar CSV no client-side.
 *
 * Pra exports grandes (>10k linhas) ou que envolvem dados sensíveis,
 * idealmente migrar pra endpoint server-side. Por ora, busca via API
 * paginada (até 1000 registros) e gera no browser — suficiente pra
 * relatórios mensais de pequena/média empresa.
 */

import { api } from './api';

export interface CsvColumn<T> {
  /** Header da coluna no CSV */
  header: string;
  /** Valor extraído de cada linha. Pode retornar number/string/null. */
  value: (row: T) => string | number | null | undefined;
}

/**
 * Escape de campo CSV — RFC 4180.
 *  - Se contém vírgula, quebra de linha ou aspas → envolve em aspas
 *  - Aspas internas viram aspas duplas
 */
function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('\n') || s.includes('"') || s.includes(';')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Gera string CSV a partir de dados + definição de colunas.
 * Usa `;` como separador (padrão BR pra abrir direto no Excel pt-BR).
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const headers = columns.map((c) => csvEscape(c.header)).join(';');
  const lines = rows.map((row) =>
    columns.map((c) => csvEscape(c.value(row))).join(';'),
  );
  // BOM no início pra Excel pt-BR detectar UTF-8 corretamente
  return '﻿' + [headers, ...lines].join('\n');
}

/**
 * Dispara download de string como arquivo no browser.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Libera memória após o download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Busca todas as páginas de um endpoint paginado e concatena.
 * Limita a `maxPages` pra evitar runaway (default 10 páginas × 100 = 1000 registros).
 *
 * Uso:
 *   const all = await fetchAllPages<Cliente>('/clientes', { search: 'X' });
 */
export async function fetchAllPages<T>(
  basePath: string,
  extraQuery: Record<string, string> = {},
  options: {
    pageSize?: number;
    maxPages?: number;
    /** Callback opcional pra feedback de progresso na UI. */
    onProgress?: (current: number, total: number) => void;
  } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 10;
  const result: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({ ...extraQuery, page: String(page), limit: String(pageSize) });
    const resp = await api.get<{ data: T[]; pagination: { totalPages: number } }>(
      `${basePath}?${qs.toString()}`,
    );
    const items = Array.isArray(resp) ? resp : resp.data ?? [];
    result.push(...items);
    const totalPages = (resp as { pagination?: { totalPages: number } })?.pagination?.totalPages;
    options.onProgress?.(page, Math.min(totalPages ?? page, maxPages));
    if (!totalPages || page >= totalPages) break;
  }

  return result;
}

/**
 * Helper completo: busca dados, gera CSV, faz download. Tudo em 1 chamada.
 *
 * Uso:
 *   await exportToCsv({
 *     endpoint: '/clientes',
 *     query: { status: 'ATIVO' },
 *     filename: 'clientes-ativos.csv',
 *     columns: [{ header: 'Nome', value: (c) => c.nome }, ...]
 *   });
 */
export async function exportToCsv<T>(args: {
  endpoint: string;
  query?: Record<string, string>;
  filename: string;
  columns: CsvColumn<T>[];
  maxPages?: number;
  pageSize?: number;
  /** Callback opcional — chamado a cada página completa pra UI mostrar progresso. */
  onProgress?: (current: number, total: number) => void;
}): Promise<{ count: number }> {
  const all = await fetchAllPages<T>(args.endpoint, args.query ?? {}, {
    maxPages: args.maxPages,
    pageSize: args.pageSize,
    onProgress: args.onProgress,
  });
  const csv = toCsv(all, args.columns);
  downloadCsv(args.filename, csv);
  return { count: all.length };
}
