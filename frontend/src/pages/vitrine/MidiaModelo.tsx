import { useRef, useState } from 'react';
import { Film, GripVertical, ImagePlus, Star, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatNumero } from '@/lib/masks';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui';
import { useArrastar } from './arrastar';
import { prepararFoto } from './imagem';
import type { Foto, ModeloCor, Video } from './tipos';

const MAX_VIDEO_MB = 50;

/**
 * Fotos de UMA cor do modelo. A 1ª é a capa; arrastar muda a ordem.
 * O navegador otimiza cada foto (WebP 1080 px + miniatura) antes de enviar.
 */
export function FotosDaCor({ modeloCor, onMudou }: { modeloCor: ModeloCor; onMudou: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  // Ordem otimista: a foto fica onde foi solta enquanto o servidor salva.
  const [ordemLocal, setOrdemLocal] = useState<string[] | null>(null);
  const fotos = ordemLocal
    ? ordemLocal
        .map((id) => modeloCor.fotos.find((f) => f.id === id))
        .filter((f): f is Foto => !!f)
    : modeloCor.fotos;
  const arrastar = useArrastar(
    fotos.map((f) => f.id),
    (ids) => {
      setOrdemLocal(ids);
      void reordenar(ids);
    },
  );

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    const lista = Array.from(arquivos);
    try {
      for (const [i, arquivo] of lista.entries()) {
        setEnviando(`Otimizando e enviando ${i + 1} de ${lista.length}…`);
        const p = await prepararFoto(arquivo);
        const form = new FormData();
        form.append('foto', p.foto, 'foto.webp');
        form.append('thumb', p.thumb, 'thumb.webp');
        form.append('largura', String(p.largura));
        form.append('altura', String(p.altura));
        await api.upload(`/vitrine/admin/cores-modelo/${modeloCor.id}/fotos`, form);
      }
      toast.success(lista.length === 1 ? 'Foto enviada' : `${lista.length} fotos enviadas`);
    } catch (err) {
      toast.error('Falha no envio da foto', apiErrorMessage(err));
    } finally {
      setEnviando(null);
      if (input.current) input.current.value = '';
      onMudou();
    }
  }

  async function tornarCapa(foto: Foto) {
    await reordenar([foto.id, ...fotos.filter((f) => f.id !== foto.id).map((f) => f.id)]);
  }

  async function reordenar(fotoIds: string[]) {
    try {
      await api.put(`/vitrine/admin/cores-modelo/${modeloCor.id}/fotos/ordem`, { fotoIds });
      onMudou();
    } catch (err) {
      toast.error('Não foi possível reordenar', apiErrorMessage(err));
    } finally {
      setOrdemLocal(null);
    }
  }

  async function excluir(foto: Foto) {
    if (!window.confirm('Excluir esta foto?')) return;
    try {
      await api.delete(`/vitrine/admin/fotos/${foto.id}`);
      onMudou();
    } catch (err) {
      toast.error('Não foi possível excluir', apiErrorMessage(err));
    }
  }

  return (
    <div className="rounded-[10px] border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-4 w-4 rounded-full border border-border"
            style={{ background: modeloCor.cor.hex }}
          />
          <span className="font-medium text-text">{modeloCor.cor.nome}</span>
          <span className="text-xs text-muted">{fotos.length} foto(s)</span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={!!enviando}
          onClick={() => input.current?.click()}
          data-testid={`vitrine-enviar-foto-${modeloCor.id}`}
        >
          <ImagePlus size={14} /> Adicionar fotos
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void enviar(e.target.files)}
        />
      </div>
      {enviando && <p className="text-xs text-muted mb-2">{enviando}</p>}
      {fotos.length > 1 && (
        <p className="text-xs text-muted mb-2">Arraste as fotos pra mudar a ordem. A primeira é a capa.</p>
      )}
      {fotos.length === 0 ? (
        <p className="text-sm text-muted">
          Sem fotos — esta cor não aparece na vitrine até ter ao menos uma.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {fotos.map((f, i) => (
            <li
              key={f.id}
              {...arrastar.props(f.id)}
              className="relative w-28 cursor-grab rounded-[10px] data-[arrastando=true]:opacity-40 data-[sobre=true]:ring-2 data-[sobre=true]:ring-primary"
              title="Arraste pra mudar a ordem"
            >
              <img
                src={f.thumbUrl ?? f.url ?? ''}
                alt={`Foto ${i + 1} de ${modeloCor.cor.nome}`}
                className="h-36 w-28 rounded-[10px] border border-border object-cover"
                loading="lazy"
                draggable={false}
              />
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded-[10px] bg-primary px-1.5 py-0.5 text-[10px] text-white">
                  capa
                </span>
              )}
              <div className="mt-1 flex items-center justify-between">
                <GripVertical size={14} className="text-muted" aria-hidden />
                {i > 0 && (
                  <button type="button" onClick={() => void tornarCapa(f)} aria-label="Usar como capa" className="text-muted hover:text-text">
                    <Star size={14} />
                  </button>
                )}
                <button type="button" onClick={() => void excluir(f)} aria-label="Excluir foto" className="text-danger">
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Vídeos do modelo (kit pra anunciar). Sobem DIRETO do navegador pro
 * armazenamento, por uma URL assinada que o servidor gera — não passam pela API.
 */
export function VideosDoModelo({
  modeloId,
  videos,
  onMudou,
}: {
  modeloId: string;
  videos: Video[];
  onMudou: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(arquivo: File | undefined) {
    if (!arquivo) return;
    if (arquivo.type !== 'video/mp4') return toast.error('Envie o vídeo em MP4');
    if (arquivo.size > MAX_VIDEO_MB * 1024 * 1024) {
      return toast.error(`Vídeo grande demais (máx. ${MAX_VIDEO_MB} MB)`);
    }
    setEnviando(true);
    try {
      const prep = await api.post<{ storagePath: string; uploadUrl: string }>(
        `/vitrine/admin/modelos/${modeloId}/videos/preparar`,
        { tamanhoBytes: arquivo.size },
      );
      // Mesmo formato que o supabase-js usa no uploadToSignedUrl.
      const form = new FormData();
      form.append('cacheControl', '31536000');
      form.append('', arquivo);
      const res = await fetch(prep.uploadUrl, {
        method: 'PUT',
        body: form,
        headers: { 'x-upsert': 'false' },
      });
      if (!res.ok) throw new Error(`O armazenamento recusou o vídeo (${res.status})`);
      await api.post(`/vitrine/admin/modelos/${modeloId}/videos`, {
        storagePath: prep.storagePath,
        nomeArquivo: arquivo.name.slice(0, 120),
        tamanhoBytes: arquivo.size,
      });
      toast.success('Vídeo enviado');
      onMudou();
    } catch (err) {
      toast.error('Falha no envio do vídeo', apiErrorMessage(err));
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = '';
    }
  }

  async function excluir(v: Video) {
    if (!window.confirm('Excluir este vídeo?')) return;
    try {
      await api.delete(`/vitrine/admin/videos/${v.id}`);
      onMudou();
    } catch (err) {
      toast.error('Não foi possível excluir', apiErrorMessage(err));
    }
  }

  return (
    <div className="rounded-[10px] border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-text">Vídeos (MP4, até {MAX_VIDEO_MB} MB)</span>
        <Button
          size="sm"
          variant="secondary"
          loading={enviando}
          onClick={() => input.current?.click()}
          data-testid="vitrine-enviar-video"
        >
          <Film size={14} /> Adicionar vídeo
        </Button>
        <input
          ref={input}
          type="file"
          accept="video/mp4"
          className="hidden"
          onChange={(e) => void enviar(e.target.files?.[0])}
        />
      </div>
      {videos.length === 0 ? (
        <p className="text-sm text-muted">Nenhum vídeo. Na vitrine eles aparecem depois das fotos.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {videos.map((v) => (
            <li key={v.id} className="flex items-center justify-between text-sm">
              <a href={v.url ?? '#'} target="_blank" rel="noreferrer" className="text-primary underline">
                {v.nomeArquivo ?? 'vídeo'}
              </a>
              <span className="flex items-center gap-3 text-muted">
                {v.tamanhoBytes ? `${formatNumero(Math.round(v.tamanhoBytes / 104_857.6) / 10)} MB` : ''}
                <button type="button" onClick={() => void excluir(v)} aria-label="Excluir vídeo" className="text-danger">
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
