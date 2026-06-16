import { useState } from 'react';
import { Image as ImageIcon, Video, Mic, Download, FileText } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';

/**
 * Hook compartilhado pra buscar a signed URL da mídia de uma mensagem.
 * Os 4 players (imagem/vídeo/áudio/documento) fazem o MESMO fetch — dedup aqui.
 */
export function useMediaUrl(msgId: string) {
  return useApiQuery<{ url: string; mime: string | null }>(`/inbox/messages/${msgId}/media`);
}

export function MessageMediaImage({ msgId }: { msgId: string }) {
  const { data, loading, error, refetch } = useMediaUrl(msgId);
  if (loading) {
    return (
      <div
        data-testid={`msg-img-loading-${msgId}`}
        className="h-32 w-48 bg-bg-alt animate-pulse rounded"
      />
    );
  }
  if (error || !data?.url) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted italic">
        <ImageIcon className="h-3.5 w-3.5" />
        <span>Imagem indisponível</span>
        <button
          type="button"
          onClick={refetch}
          className="not-italic text-primary hover:underline font-medium"
          data-testid={`msg-img-retry-${msgId}`}
        >
          tentar de novo
        </button>
      </div>
    );
  }
  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer">
      <img
        src={data.url}
        alt="Imagem da mensagem"
        data-testid={`msg-img-${msgId}`}
        className="rounded border border-border block"
        style={{ maxWidth: '320px', maxHeight: '360px', objectFit: 'contain' }}
        loading="lazy"
      />
    </a>
  );
}

/** Player de vídeo inline — controls nativos do browser. */
export function MessageMediaVideo({ msgId }: { msgId: string }) {
  const { data, loading, error, refetch } = useMediaUrl(msgId);
  const [playError, setPlayError] = useState(false);
  if (loading) {
    return (
      <div
        data-testid={`msg-video-loading-${msgId}`}
        className="h-40 w-64 bg-bg-alt animate-pulse rounded"
      />
    );
  }
  if (error || !data?.url) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted italic">
        <Video className="h-3.5 w-3.5" />
        <span>Vídeo indisponível</span>
        <button
          type="button"
          onClick={refetch}
          className="not-italic text-primary hover:underline font-medium"
        >
          tentar de novo
        </button>
      </div>
    );
  }
  const mime = data.mime ?? undefined;
  if (playError) {
    return (
      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        download={`video-${msgId}.mp4`}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-bg-alt hover:bg-surface-hover transition-colors no-underline text-sm"
      >
        <Video className="h-4 w-4 text-primary shrink-0" />
        <span>Baixar vídeo</span>
        <Download className="h-3.5 w-3.5 text-muted" />
      </a>
    );
  }
  return (
    <video
      controls
      preload="metadata"
      data-testid={`msg-video-${msgId}`}
      className="rounded border border-border block bg-black"
      // style inline garante que vídeos verticais (formato celular) não
      // ocupem a tela inteira. classes Tailwind arbitrárias `max-h-[Xpx]`
      // às vezes sumiam no purge — inline é à prova de bala.
      style={{ maxWidth: '320px', maxHeight: '360px', objectFit: 'contain' }}
      onError={() => setPlayError(true)}
    >
      {mime ? <source src={data.url} type={mime} /> : null}
      <source src={data.url} />
      Seu navegador não suporta reprodução de vídeo.
    </video>
  );
}

/** Player de áudio inline — controls nativos do browser. */
export function MessageMediaAudio({ msgId }: { msgId: string }) {
  const { data, loading, error, refetch } = useMediaUrl(msgId);
  const [playError, setPlayError] = useState(false);
  if (loading) {
    return (
      <div
        data-testid={`msg-audio-loading-${msgId}`}
        className="h-10 w-56 bg-bg-alt animate-pulse rounded"
      />
    );
  }
  if (error || !data?.url) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted italic">
        <Mic className="h-3.5 w-3.5" />
        <span>Áudio indisponível</span>
        <button
          type="button"
          onClick={refetch}
          className="not-italic text-primary hover:underline font-medium"
        >
          tentar de novo
        </button>
      </div>
    );
  }
  // WhatsApp manda áudio em audio/ogg; codecs=opus (voice note) — alguns
  // browsers velhos não tocam. Usamos <source type=...> pra dar dica e
  // mostramos fallback de download quando onError dispara.
  const mime = data.mime ?? undefined;
  if (playError) {
    return (
      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        download={`audio-${msgId}.ogg`}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-bg-alt hover:bg-surface-hover transition-colors no-underline text-sm"
      >
        <Mic className="h-4 w-4 text-primary shrink-0" />
        <span>Baixar áudio</span>
        <Download className="h-3.5 w-3.5 text-muted" />
      </a>
    );
  }
  return (
    <audio
      controls
      preload="metadata"
      data-testid={`msg-audio-${msgId}`}
      className="max-w-[280px] block"
      onError={() => setPlayError(true)}
    >
      {mime ? <source src={data.url} type={mime} /> : null}
      <source src={data.url} />
      Seu navegador não suporta reprodução de áudio.
    </audio>
  );
}

/** Documento — link de download com nome + tamanho/mime. */
export function MessageMediaDocument({ msgId, fileName }: { msgId: string; fileName?: string }) {
  const { data, loading, error, refetch } = useMediaUrl(msgId);
  if (loading) {
    return (
      <div
        data-testid={`msg-doc-loading-${msgId}`}
        className="h-12 w-48 bg-bg-alt animate-pulse rounded"
      />
    );
  }
  if (error || !data?.url) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted italic">
        <FileText className="h-3.5 w-3.5" />
        <span>Documento indisponível</span>
        <button
          type="button"
          onClick={refetch}
          className="not-italic text-primary hover:underline font-medium"
        >
          tentar de novo
        </button>
      </div>
    );
  }
  const displayName = fileName ?? 'Documento';
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      download={displayName}
      data-testid={`msg-doc-${msgId}`}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-bg-alt hover:bg-surface-hover transition-colors no-underline"
    >
      <FileText className="h-5 w-5 text-primary shrink-0" />
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-text truncate max-w-[200px]">
          {displayName}
        </span>
        {data.mime && (
          <span className="text-[10px] text-muted">{data.mime}</span>
        )}
      </div>
      <Download className="h-3.5 w-3.5 text-muted ml-1" />
    </a>
  );
}
