import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Upload, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/components/toast';
import { getSession } from '@/lib/auth-store';
import { cn } from '@/lib/cn';

const MAX_SIZE = 2 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

interface LogoUploaderProps {
  empresaId: string;
  currentLogoUrl: string | null;
  onUploaded: () => void;
}

/**
 * LogoUploader (v1.5.0) — upload de logo da empresa.
 *
 * UX:
 *  - Drag-and-drop OU click pra selecionar arquivo
 *  - Preview imediato (data URL local antes de upload)
 *  - Validações client-side: max 2MB, PNG/JPG/WebP/SVG
 *  - Aviso se imagem não for quadrada (preferência visual, não bloqueia)
 *  - Loading state durante upload (multipart)
 *  - Botão remover com confirmação
 *  - Toasts de sucesso/erro
 */
export function LogoUploader({ empresaId, currentLogoUrl, onUploaded }: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [aspectWarning, setAspectWarning] = useState(false);
  const [confirm, ConfirmDialog] = useConfirm();
  const toast = useToast();

  function validateAndPreview(file: File) {
    if (!ALLOWED.includes(file.type)) {
      toast.error('Formato não suportado', 'Use PNG, JPG, WebP ou SVG.');
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error('Arquivo muito grande', `Máx. ${MAX_SIZE / 1024 / 1024}MB.`);
      return;
    }

    // Preview imediato
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setPreviewUrl(result);

      // Detecta aspect ratio pra warning (não bloqueia)
      if (file.type !== 'image/svg+xml') {
        const img = new Image();
        img.onload = () => {
          const ratio = img.width / img.height;
          setAspectWarning(ratio < 0.85 || ratio > 1.15);
        };
        img.src = result;
      } else {
        setAspectWarning(false);
      }
    };
    reader.readAsDataURL(file);
    setSelectedFile(file);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) validateAndPreview(file);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndPreview(file);
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', selectedFile);
      const sess = getSession();
      const baseUrl =
        (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
      const res = await fetch(`${baseUrl}/api/v1/empresas/${empresaId}/logo`, {
        method: 'POST',
        body: fd,
        headers: {
          ...(sess?.accessToken ? { Authorization: `Bearer ${sess.accessToken}` } : {}),
          ...(sess?.user?.empresaIdAtiva ? { 'X-Empresa-Id': sess.user.empresaIdAtiva } : {}),
        },
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success('Logo atualizado!');
      setSelectedFile(null);
      setPreviewUrl(null);
      setAspectWarning(false);
      onUploaded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao subir logo';
      toast.error('Erro no upload', msg);
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    const ok = await confirm({
      title: 'Remover logo',
      message: 'Tem certeza? O logo voltará pro padrão Betinna.',
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;

    setRemoving(true);
    try {
      const sess = getSession();
      const baseUrl =
        (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
      const res = await fetch(`${baseUrl}/api/v1/empresas/${empresaId}/logo`, {
        method: 'DELETE',
        headers: {
          ...(sess?.accessToken ? { Authorization: `Bearer ${sess.accessToken}` } : {}),
          ...(sess?.user?.empresaIdAtiva ? { 'X-Empresa-Id': sess.user.empresaIdAtiva } : {}),
        },
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success('Logo removido.');
      onUploaded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao remover logo';
      toast.error('Erro ao remover', msg);
    } finally {
      setRemoving(false);
    }
  }

  function cancelSelection() {
    setSelectedFile(null);
    setPreviewUrl(null);
    setAspectWarning(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  const displayUrl = previewUrl ?? currentLogoUrl;

  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="logo-uploader"
        onClick={() => inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 p-6 rounded-[10px] border-2 border-dashed cursor-pointer',
          'transition-colors',
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-border bg-surface hover:border-primary/50 hover:bg-primary/5',
        )}
      >
        {displayUrl ? (
          <img
            src={displayUrl}
            alt="Logo da empresa"
            className="max-h-32 max-w-full object-contain rounded-[6px]"
            draggable={false}
          />
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted" />
            <div className="text-sm text-text text-center">
              <strong>Clique ou arraste</strong> uma imagem
            </div>
            <div className="text-xs text-muted text-center">
              PNG, JPG, WebP ou SVG · máx. 2MB · preferência quadrada
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={handleFileChange}
          className="hidden"
          data-testid="logo-input"
        />
      </div>

      {aspectWarning && previewUrl && (
        <div className="flex items-center gap-2 text-xs text-warning">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>
            A imagem não é quadrada. O logo é exibido melhor com proporção 1:1.
            Pode subir mesmo assim.
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {selectedFile && (
          <>
            <Button
              data-testid="logo-upload-save"
              variant="primary"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Enviando…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" /> Salvar logo
                </>
              )}
            </Button>
            <Button variant="secondary" onClick={cancelSelection} disabled={uploading}>
              Cancelar
            </Button>
          </>
        )}
        {!selectedFile && currentLogoUrl && (
          <Button
            data-testid="logo-remove"
            variant="secondary"
            onClick={handleRemove}
            disabled={removing}
          >
            {removing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Removendo…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" /> Remover logo
              </>
            )}
          </Button>
        )}
      </div>

      {ConfirmDialog}
    </div>
  );
}
