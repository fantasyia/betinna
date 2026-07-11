import { useRef, useState } from 'react';
import { ImageIcon, Trash2, Upload } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { getSession, getStoredEmpresaId } from '@/lib/auth-store';
import { useToast } from '@/components/toast';
import { Button, Dialog, Field } from '@/components/ui';
import { cn } from '@/lib/cn';
import { BOARD_CORES, type KBoardCompleto } from './kanban-types';

/**
 * "Personalizar fundo" do quadro: paleta de cores + upload de imagem
 * (JPG/PNG/WebP até 5MB) + remover imagem. Upload via fetch+FormData
 * (padrão de upload do app — api client é JSON-only).
 */
export function FundoDialog({
  board,
  open,
  onClose,
  onMudou,
}: {
  board: KBoardCompleto;
  open: boolean;
  onClose: () => void;
  onMudou: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function trocarCor(cor: string) {
    try {
      await api.patch(`/kanban/boards/${board.id}`, { corFundo: cor });
      onMudou();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function subirImagem(file: File) {
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const sess = getSession();
      const empresaId = sess?.user.empresaIdAtiva ?? getStoredEmpresaId();
      const baseUrl =
        (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
      const res = await fetch(`${baseUrl}/api/v1/kanban/boards/${board.id}/fundo`, {
        method: 'POST',
        body: fd,
        headers: {
          ...(sess?.accessToken ? { Authorization: `Bearer ${sess.accessToken}` } : {}),
          ...(empresaId ? { 'X-Empresa-Id': empresaId } : {}),
        },
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: { message?: string };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message ?? `Falha no upload (${res.status})`);
      }
      toast.success('Fundo atualizado');
      onMudou();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no upload');
    } finally {
      setEnviando(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removerImagem() {
    try {
      await api.delete(`/kanban/boards/${board.id}/fundo`);
      toast.success('Imagem removida — voltou pra cor');
      onMudou();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Personalizar fundo">
      <div className="flex flex-col gap-4">
        {board.imagemFundoUrl && (
          <div
            className="h-24 rounded-[10px] bg-cover bg-center border border-border"
            style={{ backgroundImage: `url(${board.imagemFundoUrl})` }}
            aria-label="Fundo atual"
          />
        )}

        <Field label="Imagem (JPG, PNG ou WebP · máx 5MB)">
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              data-testid="fundo-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void subirImagem(f);
              }}
            />
            <Button
              variant="secondary"
              leftIcon={<Upload className="h-4 w-4" />}
              loading={enviando}
              onClick={() => fileRef.current?.click()}
              data-testid="fundo-upload"
            >
              {board.imagemFundoUrl ? 'Trocar imagem' : 'Enviar imagem'}
            </Button>
            {board.imagemFundoUrl && (
              <Button
                variant="ghost"
                leftIcon={<Trash2 className="h-4 w-4" />}
                onClick={() => void removerImagem()}
                data-testid="fundo-remover"
              >
                Remover
              </Button>
            )}
          </div>
        </Field>

        <Field
          label="Ou uma cor"
          hint={board.imagemFundoUrl ? 'A cor fica como fallback enquanto a imagem existir' : undefined}
        >
          <div className="flex flex-wrap gap-2">
            {BOARD_CORES.map((cor) => (
              <button
                key={cor}
                type="button"
                aria-label={`Cor ${cor}`}
                onClick={() => void trocarCor(cor)}
                className={cn(
                  'h-8 w-12 rounded-[6px] transition-transform hover:scale-105',
                  board.corFundo === cor && 'ring-2 ring-offset-2 ring-primary scale-105',
                )}
                style={{ background: cor }}
              />
            ))}
          </div>
        </Field>

        <p className="text-[11px] text-muted m-0 inline-flex items-center gap-1">
          <ImageIcon className="h-3.5 w-3.5" />
          A imagem aparece na grade de quadros e como fundo das colunas.
        </p>
      </div>
    </Dialog>
  );
}
