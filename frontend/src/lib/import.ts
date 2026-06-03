/**
 * Cliente tipado pro endpoint /import. Frontend pode usar diretamente
 * sem precisar montar tipos manualmente.
 */
import { api } from './api';

export type ImportTipo = 'clientes' | 'produtos';
export type OnDuplicate = 'skip' | 'update' | 'error';

export interface ImportRequest {
  csv: string;
  dryRun?: boolean;
  onDuplicate?: OnDuplicate;
}

export interface ImportLinhaResult {
  linha: number;
  status: 'criado' | 'atualizado' | 'pulado' | 'erro';
  id?: string;
  motivo?: string;
}

export interface ImportResult {
  total: number;
  criados: number;
  atualizados: number;
  pulados: number;
  erros: number;
  dryRun: boolean;
  detalhes: ImportLinhaResult[];
}

/**
 * Lê arquivo CSV (File) e envia pro backend. Limita 1MB.
 * Pra arquivos maiores, frontend deve fazer batches (split por linhas).
 */
export async function readCsvFile(file: File): Promise<string> {
  const MAX_BYTES = 1024 * 1024;
  if (file.size > MAX_BYTES) {
    throw new Error(
      `Arquivo muito grande (${(file.size / 1024).toFixed(0)} KB). Máximo ${MAX_BYTES / 1024} KB.`,
    );
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Falha lendo arquivo'));
    reader.readAsText(file, 'utf-8');
  });
}

/** Payload do import de leads — aceita `rows` (xlsx parseado no client) OU `csv`. */
export interface ImportLeadsRequest {
  csv?: string;
  rows?: Record<string, string>[];
  funilId?: string;
  funilEtapaId?: string;
  dryRun?: boolean;
  onDuplicate?: OnDuplicate;
}

/**
 * Lê um arquivo de import e devolve o pedaço do payload pro backend:
 *  - .xlsx/.xls → parseia no client (exceljs) e manda `rows`
 *  - .csv/.txt  → manda `csv` (texto cru; backend parseia com papaparse)
 *
 * O exceljs (~700KB) só é carregado quando o arquivo é de fato xlsx.
 */
export async function readImportFile(
  file: File,
): Promise<{ rows: Record<string, string>[] } | { csv: string }> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'xlsx' || ext === 'xls') {
    const { readXlsxRows } = await import('./xlsx');
    return { rows: await readXlsxRows(file) };
  }
  return { csv: await readCsvFile(file) };
}

export async function importLeads(req: ImportLeadsRequest): Promise<ImportResult> {
  return api.post<ImportResult>('/import/leads', req);
}

export async function importClientes(req: ImportRequest): Promise<ImportResult> {
  return api.post<ImportResult>('/import/clientes', req);
}

export async function importProdutos(req: ImportRequest): Promise<ImportResult> {
  return api.post<ImportResult>('/import/produtos', req);
}

/**
 * Helper: faz dryRun primeiro, retorna preview, então caller decide
 * se confirma e dispara import real.
 */
export async function previewImport(
  tipo: ImportTipo,
  csv: string,
  onDuplicate: OnDuplicate = 'skip',
): Promise<ImportResult> {
  const fn = tipo === 'clientes' ? importClientes : importProdutos;
  return fn({ csv, dryRun: true, onDuplicate });
}

/**
 * Helper: confirma e dispara import real.
 */
export async function confirmarImport(
  tipo: ImportTipo,
  csv: string,
  onDuplicate: OnDuplicate = 'skip',
): Promise<ImportResult> {
  const fn = tipo === 'clientes' ? importClientes : importProdutos;
  return fn({ csv, dryRun: false, onDuplicate });
}
