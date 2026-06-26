/**
 * Export Excel (.xlsx) — wrapper que faz dynamic import do `exceljs`.
 *
 * Migrado de `xlsx@0.18` (sheetjs) → `exceljs@4` em 2026-05-17 (auditoria):
 *  - sheetjs tinha 2 CVEs sem fix upstream (proto pollution + ReDoS)
 *  - exceljs é maintained, sem CVEs, API streaming-friendly
 *  - Output binário: ambos geram .xlsx compatível com Excel/Google Sheets/LibreOffice
 *
 * Mantemos `CsvColumn<T>` (`lib/csv.ts`) como definição compartilhada de colunas.
 */

import { fetchAllPages, neutralizarFormula, type CsvColumn } from './csv';

export type XlsxColumn<T> = CsvColumn<T>;

/**
 * Busca dados (paginação) + gera .xlsx + dispara download.
 * Mesma API de `exportToCsv` pra trocar facilmente.
 */
export async function exportToXlsx<T>(args: {
  endpoint: string;
  query?: Record<string, string>;
  filename: string;
  sheetName?: string;
  columns: XlsxColumn<T>[];
  maxPages?: number;
  pageSize?: number;
  onProgress?: (current: number, total: number) => void;
}): Promise<{ count: number }> {
  const all = await fetchAllPages<T>(args.endpoint, args.query ?? {}, {
    maxPages: args.maxPages,
    pageSize: args.pageSize,
    onProgress: args.onProgress,
  });

  await rowsToXlsx({
    rows: all,
    filename: args.filename,
    sheetName: args.sheetName,
    columns: args.columns,
  });

  return { count: all.length };
}

/**
 * In-memory: recebe rows prontos (não chama API).
 */
export async function rowsToXlsx<T>(args: {
  rows: T[];
  filename: string;
  sheetName?: string;
  columns: XlsxColumn<T>[];
}): Promise<void> {
  // Dynamic import — exceljs pesa ~700KB. Só carrega quando user clica Excel.
  const ExcelJS = await import('exceljs');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Betinna.ai';
  wb.created = new Date();

  const sheetName = (args.sheetName ?? args.filename.replace(/\.xlsx?$/i, '')).slice(0, 31);
  const sheet = wb.addWorksheet(sheetName || 'Dados', {
    views: [{ state: 'frozen', ySplit: 1 }], // freeze header
  });

  // Headers
  sheet.columns = args.columns.map((c) => {
    // Width auto: começa em max(header, 8)
    return { header: c.header, key: c.header, width: Math.max(8, c.header.length + 2) };
  });

  // Bold + cor de fundo no header
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFEFF5' },
    };
    cell.alignment = { vertical: 'middle' };
  });

  // Body
  for (const row of args.rows) {
    const obj: Record<string, string | number | null> = {};
    for (const col of args.columns) {
      const v = col.value(row);
      // Anti-formula-injection: mesma neutralização do CSV (PII de canal público vira fórmula).
      obj[col.header] = v === undefined ? null : typeof v === 'string' ? neutralizarFormula(v) : v;
    }
    sheet.addRow(obj);
  }

  // Auto-ajusta widths baseado no maior conteúdo
  sheet.columns.forEach((col, idx) => {
    let maxLen = args.columns[idx].header.length;
    sheet.getColumn(idx + 1).eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const len = v == null ? 0 : String(v).length;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min(60, Math.max(8, maxLen + 2));
  });

  const buffer = await wb.xlsx.writeBuffer();
  const filename = args.filename.endsWith('.xlsx') ? args.filename : `${args.filename}.xlsx`;
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
}

/**
 * Lê um .xlsx/.xls (File) → array de objetos `{cabecalho_lowercase: valor}`.
 *
 * Espelha o `transformHeader` do papaparse no backend (lowercase + trim) pra
 * as keys baterem com o mapeamento de colunas do import (linha.nome, linha.telefone…).
 * Usa a PRIMEIRA planilha; linha 1 = cabeçalho. Linhas 100% vazias são ignoradas.
 */
export async function readXlsxRows(file: File): Promise<Record<string, string>[]> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  // Cabeçalho (linha 1) → keys normalizadas
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellToString(cell.value).toLowerCase().trim();
  });
  if (headers.every((h) => !h)) return [];

  const rows: Record<string, string>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // pula cabeçalho
    const obj: Record<string, string> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headers[col - 1];
      if (!key) return;
      const v = cellToString(cell.value).trim();
      if (v) hasValue = true;
      obj[key] = v;
    });
    if (hasValue) rows.push(obj);
  });
  return rows;
}

/** Converte qualquer CellValue do exceljs (rich text, fórmula, data, link…) pra string. */
function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toLocaleDateString('pt-BR');
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
    }
    if (o.text != null) return String(o.text);
    if (o.result != null) return String(o.result);
    if (o.hyperlink != null) return String(o.hyperlink);
  }
  return String(value);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
