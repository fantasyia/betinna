import { useRef, useState } from 'react';
import { BookText, Mic, Paperclip, Square, Trash2, X } from 'lucide-react';
import { Button, Field } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { useGravacaoVoz } from '@/pages/inbox/hooks/useGravacaoVoz';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/** Anexo guardado no config do nó — só a referência no Storage (não o base64). */
interface MidiaConfig {
  tipo: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';
  storagePath: string;
  mimetype?: string;
  fileName?: string;
  ptt?: boolean;
  /** Nome só pra exibir no editor (o backend ignora). */
  nomeExibicao?: string;
}

/** Documento "enviável" da base de conhecimento (reusável como anexo do nó). */
interface DocEnviavel {
  id: string;
  titulo: string;
  fileName: string;
  mimetype: string;
  storagePath: string;
  podeEnviar: boolean;
}

const MAX_BYTES = 14 * 1024 * 1024; // 14MB raw (~18,7MB em base64, com folga sob o body limit de 20MB)
const LABEL_TIPO: Record<string, string> = {
  IMAGE: 'Imagem',
  VIDEO: 'Vídeo',
  AUDIO: 'Áudio',
  DOCUMENT: 'Documento',
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    r.readAsDataURL(file);
  });
}

function tipoDoMime(mime: string): MidiaConfig['tipo'] {
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  return 'DOCUMENT';
}

/**
 * Anexo OPCIONAL do nó Enviar WhatsApp: anexar arquivo (imagem/PDF/doc/áudio) OU gravar áudio na hora
 * (vai como mensagem de voz/PTT). O arquivo sobe pro Storage na hora (POST /fluxos/midia) e o nó
 * guarda só o `storagePath`. A "mensagem" do nó vira a LEGENDA quando há anexo.
 */
export function WhatsAppMidiaAnexo({
  data,
  onUpdate,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [biblioteca, setBiblioteca] = useState<DocEnviavel[] | null>(null);
  const [carregandoBib, setCarregandoBib] = useState(false);
  const midia = data.config.midia as MidiaConfig | undefined;

  // Abre o seletor da base de conhecimento (só docs marcados "Bot pode enviar").
  async function abrirBiblioteca() {
    setCarregandoBib(true);
    try {
      const docs = await api.get<DocEnviavel[]>('/conhecimento/documentos');
      setBiblioteca(docs.filter((d) => d.podeEnviar));
    } catch (err) {
      toast.error('Falha ao carregar a base', err instanceof ApiError ? err.message : undefined);
    } finally {
      setCarregandoBib(false);
    }
  }

  // Escolhe um doc da base como anexo — só referencia o Storage (NÃO re-faz upload).
  function escolherDaBase(doc: DocEnviavel) {
    onUpdate((d) => ({
      ...d,
      config: {
        ...d.config,
        midia: {
          tipo: tipoDoMime(doc.mimetype || ''),
          storagePath: doc.storagePath,
          mimetype: doc.mimetype || undefined,
          fileName: doc.fileName,
          nomeExibicao: doc.titulo,
        },
      },
    }));
    setBiblioteca(null);
    toast.success('Documento da base anexado');
  }

  async function subir(file: File, ptt: boolean) {
    if (file.size > MAX_BYTES) {
      toast.error('Arquivo muito grande', 'O limite é 14MB.');
      return;
    }
    const tipo = tipoDoMime(file.type || '');
    setEnviando(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await api.post<MidiaConfig>('/fluxos/midia', {
        tipo,
        mimetype: file.type || undefined,
        fileName: tipo === 'DOCUMENT' ? file.name : undefined,
        ptt: tipo === 'AUDIO' ? ptt : undefined,
        dataBase64,
      });
      onUpdate((d) => ({
        ...d,
        config: { ...d.config, midia: { ...res, nomeExibicao: file.name } },
      }));
      toast.success('Anexo pronto');
    } catch {
      toast.error('Falha ao subir o anexo');
    } finally {
      setEnviando(false);
    }
  }

  const { recording, recordSeconds, startRecording, stopRecording, cancelRecording } = useGravacaoVoz({
    onGravado: (file) => void subir(file, true), // gravado na hora = PTT (mensagem de voz)
    onErro: (m) => {
      if (m) toast.error(m);
    },
  });

  function remover() {
    onUpdate((d) => {
      const novo = { ...d.config };
      delete (novo as Record<string, unknown>).midia;
      return { ...d, config: novo };
    });
  }

  const mmss = `${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, '0')}`;

  return (
    <Field
      label="Anexo (opcional)"
      hint="Com anexo, a mensagem acima vira a legenda. Áudio gravado vai como mensagem de voz."
    >
      <div>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void subir(f, false); // arquivo anexado = áudio normal (não PTT)
            e.target.value = '';
          }}
        />

        {midia ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
          <span className="truncate">
            📎 {LABEL_TIPO[midia.tipo] ?? midia.tipo}
            {midia.ptt ? ' · voz' : ''}
            {midia.nomeExibicao ? ` · ${midia.nomeExibicao}` : midia.fileName ? ` · ${midia.fileName}` : ''}
          </span>
          <Button size="sm" variant="ghost" onClick={remover} aria-label="Remover anexo">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : recording !== 'idle' ? (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 text-sm text-danger">
            <span className="h-2 w-2 animate-pulse rounded-full bg-danger" /> Gravando {mmss}
          </span>
          <Button size="sm" variant="secondary" onClick={cancelRecording} aria-label="Cancelar">
            <X className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={stopRecording}>
            <Square className="h-4 w-4" /> Usar
          </Button>
        </div>
      ) : biblioteca !== null ? (
        <div className="rounded-md border border-border bg-bg-alt p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-text-subtle">Base de conhecimento</span>
            <Button size="sm" variant="ghost" onClick={() => setBiblioteca(null)} aria-label="Fechar">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {biblioteca.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted">
              Nenhum documento marcado como “Bot pode enviar”. Ative um em Base de conhecimento.
            </p>
          ) : (
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {biblioteca.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => escolherDaBase(doc)}
                    data-testid={`midia-base-doc-${doc.id}`}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
                  >
                    <BookText className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate">{doc.titulo}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={enviando}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" /> {enviando ? 'Enviando…' : 'Anexar arquivo'}
          </Button>
          <Button size="sm" variant="secondary" disabled={enviando} onClick={() => startRecording()}>
            <Mic className="h-4 w-4" /> Gravar áudio
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={carregandoBib}
            onClick={() => void abrirBiblioteca()}
            data-testid="midia-abrir-base"
          >
            <BookText className="h-4 w-4" /> {carregandoBib ? 'Abrindo…' : 'Da base de conhecimento'}
          </Button>
        </div>
      )}
      </div>
    </Field>
  );
}
