import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Mensagem } from '../lib/types';

/**
 * Encapsula o ENVIO de texto e mídia da thread (extraído do ConversationThread).
 *
 * - `sending` é ÚNICO e bloqueia texto + mic + anexo juntos (a thread usa
 *   `disabled={sending || recording !== 'idle'}`).
 * - `enviarMidia` é chamado de 3 lugares: gravação de voz, botão de imagem e
 *   botão de anexo — por isso fica aqui (compartilhado).
 * - Cada envio (texto ou mídia) revalida a thread na cadeia
 *   refetchMsgs() + refetchConv() + onChanged().
 *
 * `resposta`/`respondendoA` continuam no ConversationThread (compartilhados com o
 * composer/JSX) — o hook recebe os valores e os setters via params.
 */
export interface UseEnvioMensagemParams {
  id: string;
  resposta: string;
  setResposta: (v: string) => void;
  respondendoA: Mensagem | null;
  setRespondendoA: (v: Mensagem | null) => void;
  /** Outros atendentes na conversa agora (presença) — dispara o confirm anti-duplo. */
  outros: Array<{ id: string; nome: string }>;
  refetchMsgs: () => void;
  refetchConv: () => void;
  onChanged: () => void;
}

export function useEnvioMensagem({
  id,
  resposta,
  setResposta,
  respondendoA,
  setRespondendoA,
  outros,
  refetchMsgs,
  refetchConv,
  onChanged,
}: UseEnvioMensagemParams) {
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Refs pros 2 inputs file (escondidos — clicados pelos botões de anexar).
  // Áudio NÃO tem upload por aqui — só gravação via MediaRecorder.
  // Paperclip cobre o caso de ter um áudio já gravado em arquivo.
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  async function enviar() {
    const texto = resposta.trim();
    if (!texto) return;
    // Item #25 fatia 4 — se outro(s) atendente(s) estão nesta conversa agora,
    // confirma antes de enviar pra evitar resposta em duplicidade.
    if (outros.length > 0) {
      const nomes = outros.map((o) => o.nome).join(', ');
      const verbo = outros.length > 1 ? 'estão' : 'está';
      if (!window.confirm(`${nomes} também ${verbo} nesta conversa. Enviar mesmo assim?`)) {
        return;
      }
    }
    setSending(true);
    setSendError(null);
    try {
      await api.post(`/inbox/${id}/responder`, {
        texto,
        ...(respondendoA ? { respondendoA: respondendoA.id } : {}),
      });
      setResposta('');
      setRespondendoA(null);
      refetchMsgs();
      refetchConv();
      onChanged();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Falha ao enviar');
    } finally {
      setSending(false);
    }
  }

  /** Converte File → base64 puro (sem prefixo data:...). */
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // result = "data:<mime>;base64,<base64>" — pega só a parte depois da vírgula
        resolve(result.split(',')[1] ?? '');
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function enviarMidia(file: File, tipo: 'IMAGE' | 'AUDIO' | 'DOCUMENT') {
    // Limite ~12MB raw (base64 fica ~16MB no JSON, dentro do body limit de 20MB)
    const MAX_MB = 12;
    if (file.size > MAX_MB * 1024 * 1024) {
      setSendError(
        `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Limite ${MAX_MB}MB.`,
      );
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const dataBase64 = await fileToBase64(file);
      await api.post(`/inbox/${id}/responder-midia`, {
        tipo,
        mimetype: file.type || undefined,
        fileName: tipo === 'DOCUMENT' ? file.name : undefined,
        // Pra áudio, marca como PTT (voice note) — fica com player no WhatsApp
        ptt: tipo === 'AUDIO' || undefined,
        dataBase64,
      });
      refetchMsgs();
      refetchConv();
      onChanged();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Falha ao enviar mídia');
    } finally {
      setSending(false);
    }
  }

  function onFileSelected(
    e: React.ChangeEvent<HTMLInputElement>,
    tipo: 'IMAGE' | 'AUDIO' | 'DOCUMENT',
  ) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-selecionar o mesmo arquivo
    if (!file) return;
    void enviarMidia(file, tipo);
  }

  /** Anexar: deduz tipo do mime do arquivo (imagem/áudio/vídeo/documento) */
  function onAttachSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const mime = file.type || '';
    let tipo: 'IMAGE' | 'AUDIO' | 'DOCUMENT';
    if (mime.startsWith('image/')) tipo = 'IMAGE';
    else if (mime.startsWith('audio/')) tipo = 'AUDIO';
    else tipo = 'DOCUMENT';
    void enviarMidia(file, tipo);
  }

  return {
    sending,
    sendError,
    setSendError,
    enviar,
    enviarMidia,
    onFileSelected,
    onAttachSelected,
    imageInputRef,
    attachInputRef,
  };
}
