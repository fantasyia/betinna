import { useRef, useState } from 'react';
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button, Dialog, Field, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { ApiError } from '@/lib/api';
import {
  importClientes,
  readImportFile,
  type ImportClientesRequest,
  type ImportResult,
} from '@/lib/import';
import { rowsToXlsx } from '@/lib/xlsx';
import { cn } from '@/lib/cn';

/**
 * Import de clientes em lote (Excel/CSV). Mesmo fluxo do de leads — escolher
 * arquivo → pré-visualizar (dryRun) → confirmar. xlsx é parseado no client
 * (exceljs); csv vai como texto. Backend dedup por CNPJ > e-mail.
 */
const TEMPLATE_HEADERS = ['Nome', 'CNPJ', 'E-mail', 'Telefone', 'Cidade', 'UF', 'Segmento'];
const TEMPLATE_EXEMPLO: Record<string, string> = {
  Nome: 'Padaria do João LTDA',
  CNPJ: '12.345.678/0001-90',
  'E-mail': 'contato@padariadojoao.com',
  Telefone: '(11) 99999-0000',
  Cidade: 'São Paulo',
  UF: 'SP',
  Segmento: 'Padaria',
};

type Payload = { rows: Record<string, string>[] } | { csv: string };

export function ImportClientesModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update' | 'error'>('skip');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'parse' | 'preview' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rowsCount = payload && 'rows' in payload ? payload.rows.length : null;

  function reset() {
    setPayload(null);
    setFileName(null);
    setPreview(null);
    setError(null);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy('parse');
    setError(null);
    setPreview(null);
    try {
      const p = await readImportFile(file);
      const count = 'rows' in p ? p.rows.length : null;
      if (count === 0) {
        setError('A planilha não tem linhas de dados (só o cabeçalho?).');
        setPayload(null);
        setFileName(null);
      } else {
        setPayload(p);
        setFileName(file.name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha lendo o arquivo');
      setPayload(null);
      setFileName(null);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function buildReq(dryRun: boolean): ImportClientesRequest {
    return { ...(payload as Payload), dryRun, onDuplicate };
  }

  function apiMsg(err: unknown) {
    return err instanceof ApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : 'Falha na operação';
  }

  async function doPreview() {
    if (!payload) return;
    setBusy('preview');
    setError(null);
    try {
      setPreview(await importClientes(buildReq(true)));
    } catch (err) {
      setError(apiMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function doConfirm() {
    if (!payload) return;
    setBusy('confirm');
    setError(null);
    try {
      const r = await importClientes(buildReq(false));
      const partes = [`${r.criados} criados`];
      if (r.atualizados) partes.push(`${r.atualizados} atualizados`);
      if (r.pulados) partes.push(`${r.pulados} pulados`);
      if (r.erros) partes.push(`${r.erros} com erro`);
      toast.success('Importação concluída', partes.join(' · '));
      onDone();
    } catch (err) {
      setError(apiMsg(err));
    } finally {
      setBusy(null);
    }
  }

  function baixarModelo() {
    void rowsToXlsx({
      rows: [TEMPLATE_EXEMPLO],
      filename: 'modelo-clientes.xlsx',
      sheetName: 'Clientes',
      columns: TEMPLATE_HEADERS.map((h) => ({
        header: h,
        value: (r: Record<string, string>) => r[h] ?? '',
      })),
    });
  }

  const errosPreview = preview?.detalhes.filter((d) => d.status === 'erro').slice(0, 8) ?? [];

  return (
    <Dialog
      open
      onClose={onClose}
      title="Importar clientes"
      description="Suba uma planilha (.xlsx) ou .csv. Pré-visualize antes de confirmar."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-testid="import-cli-cancel-btn">
            Cancelar
          </Button>
          {preview ? (
            <Button
              data-testid="import-cli-confirm-btn"
              loading={busy === 'confirm'}
              disabled={preview.criados + preview.atualizados === 0}
              onClick={() => void doConfirm()}
              leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
            >
              Confirmar importação ({preview.criados + preview.atualizados})
            </Button>
          ) : (
            <Button
              data-testid="import-cli-preview-btn"
              loading={busy === 'preview'}
              disabled={!payload || busy != null}
              onClick={() => void doPreview()}
            >
              Pré-visualizar
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* 1 — Arquivo */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              1. Arquivo
            </span>
            <button
              type="button"
              data-testid="import-cli-template-btn"
              onClick={baixarModelo}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <Download className="h-3 w-3" />
              Baixar modelo (.xlsx)
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv"
            onChange={(e) => void onPickFile(e)}
            className="hidden"
            data-testid="import-cli-file-input"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy === 'parse'}
            className={cn(
              'w-full flex items-center gap-3 rounded-md border border-dashed px-4 py-3 text-left transition-colors',
              fileName
                ? 'border-primary/40 bg-primary/5'
                : 'border-border hover:border-primary/50 hover:bg-surface-hover',
            )}
          >
            {busy === 'parse' ? (
              <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
            ) : fileName ? (
              <FileSpreadsheet className="h-5 w-5 text-primary shrink-0" />
            ) : (
              <Upload className="h-5 w-5 text-muted shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium text-text truncate">
                {fileName ?? 'Escolher arquivo…'}
              </div>
              <div className="text-[11px] text-muted">
                {rowsCount != null
                  ? `${rowsCount} linha(s) detectada(s)`
                  : fileName
                    ? 'CSV — linhas contadas no servidor'
                    : '.xlsx, .xls ou .csv · até 5000 linhas'}
              </div>
            </div>
          </button>
        </div>

        {/* 2 — Duplicatas */}
        <Field label="Se já existir cliente (mesmo CNPJ ou e-mail)">
          <Select
            data-testid="import-cli-onduplicate-select"
            value={onDuplicate}
            onChange={(e) => {
              setOnDuplicate(e.target.value as 'skip' | 'update' | 'error');
              setPreview(null);
            }}
          >
            <option value="skip">Pular (não duplicar)</option>
            <option value="update">Atualizar o cliente existente</option>
            <option value="error">Reportar como erro</option>
          </Select>
        </Field>

        {/* 3 — Prévia */}
        {preview && (
          <div data-testid="import-cli-preview" className="rounded-md border border-border bg-bg-alt p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
              Prévia (nada foi salvo ainda)
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <Stat label="Total" value={preview.total} />
              <Stat label="A criar" value={preview.criados} tone="success" />
              <Stat
                label={onDuplicate === 'update' ? 'A atualizar' : 'A pular'}
                value={onDuplicate === 'update' ? preview.atualizados : preview.pulados}
              />
              <Stat label="Erros" value={preview.erros} tone={preview.erros ? 'danger' : undefined} />
            </div>
            {errosPreview.length > 0 && (
              <div className="mt-3 border-t border-border pt-2">
                <div className="text-[11px] font-medium text-danger mb-1">Primeiros erros:</div>
                <ul className="text-[11px] text-text-subtle space-y-0.5 max-h-32 overflow-y-auto">
                  {errosPreview.map((d, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-muted tabular shrink-0">L{d.linha}</span>
                      <span className="truncate">{d.motivo}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            data-testid="import-cli-error"
            className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {payload && fileName && !preview && (
          <button
            type="button"
            onClick={reset}
            className="text-[11px] text-muted hover:text-text self-start"
          >
            Trocar arquivo
          </button>
        )}
      </div>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="rounded-md bg-surface border border-border px-2 py-1.5">
      <div
        className={cn(
          'text-lg font-bold tabular',
          tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-text',
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
