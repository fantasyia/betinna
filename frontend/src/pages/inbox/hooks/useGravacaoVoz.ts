import { useEffect, useRef, useState } from 'react';

/**
 * Máquina de estados do gravador de voice note (MediaRecorder), extraída do
 * ConversationThread.
 *
 * Estado: 'idle' (sem gravar) | 'recording' (capturando) | 'paused' (pausado).
 *
 * `isCancellingRef` é um REF (não state) DE PROPÓSITO: dentro do `onstop` o
 * valor de um state estaria stale. A flag decide descartar-vs-enviar o áudio —
 * NUNCA troque por state.
 *
 * O `onstop` chama `onGravado(file)` em vez de importar o envio direto — o
 * acoplamento com o envio fica no ConversationThread
 * (`onGravado: (file) => enviarMidia(file, 'AUDIO')`).
 */
type RecordingState = 'idle' | 'recording' | 'paused';

export interface UseGravacaoVozParams {
  /** Chamado com o File do áudio gravado quando a gravação é PARADA (não cancelada). */
  onGravado: (file: File) => void;
  /**
   * Reporta erro de gravação (ex.: falha ao acessar o microfone) ou limpa o erro
   * com `null` ao iniciar uma gravação. A thread liga isso no mesmo `sendError`
   * do envio — comportamento idêntico ao antigo `startRecording`.
   */
  onErro?: (mensagem: string | null) => void;
}

export function useGravacaoVoz({ onGravado, onErro }: UseGravacaoVozParams) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  // Flag de cancelamento — onstop checa pra descartar o áudio.
  // useRef pra valor SÍNCRONO acessível dentro do callback (state seria stale).
  const isCancellingRef = useRef(false);
  // Stream ativo — guardado pra soltar os tracks no teardown de unmount.
  const streamRef = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState<RecordingState>('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // onGravado pode mudar de identidade a cada render (closure do enviarMidia).
  // Guarda num ref pra o onstop sempre chamar a versão mais recente sem
  // recriar handlers/efeitos.
  const onGravadoRef = useRef(onGravado);
  onGravadoRef.current = onGravado;
  const onErroRef = useRef(onErro);
  onErroRef.current = onErro;

  function startTimer() {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
  }
  function stopTimer() {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }

  async function startRecording() {
    onErroRef.current?.(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // webm/opus é o que browser oferece. Mas pra WhatsApp aceitar como voice
      // note, mandamos com mimetype 'audio/ogg; codecs=opus' na hora do envio
      // (o codec Opus é o mesmo, só o container que muda — WhatsApp tolera).
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      audioChunksRef.current = [];
      isCancellingRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // Sempre solta o mic ao parar (mesmo se cancelado), pra tirar o
        // indicador vermelho de "gravando" do navegador.
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        // Cancelado: descarta sem enviar nada
        if (isCancellingRef.current) {
          audioChunksRef.current = [];
          isCancellingRef.current = false;
          return;
        }
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        if (blob.size === 0) return;
        // Voice note: força mime 'audio/ogg; codecs=opus' pra WhatsApp aceitar
        // como voice note (push-to-talk). O conteúdo Opus interno é compatível.
        const file = new File([blob], `voice-${Date.now()}.ogg`, {
          type: 'audio/ogg; codecs=opus',
        });
        onGravadoRef.current(file);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording('recording');
      setRecordSeconds(0);
      startTimer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onErroRef.current?.(`Não consegui acessar o microfone: ${msg}`);
    }
  }

  function pauseRecording() {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return;
    mediaRecorderRef.current.pause();
    setRecording('paused');
    stopTimer();
  }

  function resumeRecording() {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'paused') return;
    mediaRecorderRef.current.resume();
    setRecording('recording');
    startTimer();
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return;
    isCancellingRef.current = false;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    setRecording('idle');
    stopTimer();
  }

  function cancelRecording() {
    if (!mediaRecorderRef.current) return;
    // Marca cancelamento ANTES do stop pra onstop saber que tem que descartar.
    isCancellingRef.current = true;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    setRecording('idle');
    stopTimer();
  }

  // ⚠️FIX — teardown no unmount: se estiver gravando ao trocar de conversa /
  // desmontar, PARA o MediaRecorder e SOLTA os tracks do stream (senão o mic
  // fica preso e o indicador vermelho do navegador some só ao recarregar a
  // página). Trata como CANCELAMENTO pra não disparar envio (onstop descarta).
  useEffect(() => {
    return () => {
      stopTimer();
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        // Cancelamento: o onstop checa isCancellingRef e descarta sem chamar onGravado.
        isCancellingRef.current = true;
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch {
          // ignora — recorder já inativo
        }
        mediaRecorderRef.current = null;
      }
      // Garante o release do mic mesmo que o onstop não dispare (ex.: já inativo).
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // Sem deps: roda só no unmount. Os refs são estáveis.
  }, []);

  return {
    recording,
    recordSeconds,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
  };
}
