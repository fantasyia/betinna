import {
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Reply,
  Send,
  Smile,
  Square,
  X,
} from 'lucide-react';
import { Button, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Conversation, Mensagem, RespostaRapida } from '../lib/types';
import { canalSemTextoLivre, EMOJIS, STATUS_LABEL } from '../lib/canais';
import type { useEnvioMensagem } from '../hooks/useEnvioMensagem';
import type { useGravacaoVoz } from '../hooks/useGravacaoVoz';
import type { useApiQuery } from '@/hooks/useApiQuery';

type EnvioApi = ReturnType<typeof useEnvioMensagem>;
type GravacaoApi = ReturnType<typeof useGravacaoVoz>;
type TemplatesQuery = ReturnType<typeof useApiQuery<RespostaRapida[]>>;

/**
 * Caixa de resposta INTEIRA da thread (a maior região do ConversationThread) —
 * extraída no refactor 2026-06-16. JSX movido VERBATIM:
 *  - banner de canal sem texto livre (compose oculto)
 *  - inputs file escondidos + banner de gravação ativa (timer/pausar/cancelar/enviar)
 *  - preview "respondendo a…" (quote), barra de botões (imagem/mic/anexo só WA +
 *    emoji picker), dropdown de templates ("/"), Textarea com atalhos
 *    (Ctrl+Enter envia, Ctrl+/ templates, Esc limpa), botão Enviar e o rodapé
 *    com sendError/contador
 *  - aviso de conversa resolvida/arquivada (lockedCompose)
 *
 * ⚠️ Preserva: emoji picker absolute + backdrop fixed (fecha ao clicar fora);
 * dropdown de templates filtrado por "/"; os atalhos de teclado;
 * `disabled={sending || recording !== 'idle'}` nos botões; e a lógica
 * `canalSemTextoLivre`/`lockedCompose`. `inserirEmoji` é interno (mexe no
 * composeRef + setResposta).
 */
export function Composer({
  conv,
  resposta,
  setResposta,
  respondendoA,
  setRespondendoA,
  composeRef,
  emojiAberto,
  setEmojiAberto,
  templates,
  inserirTemplate,
  envio,
  gravacao,
}: {
  conv: Conversation | null | undefined;
  resposta: string;
  setResposta: (v: string) => void;
  respondendoA: Mensagem | null;
  setRespondendoA: (v: Mensagem | null) => void;
  composeRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  emojiAberto: boolean;
  setEmojiAberto: (v: boolean | ((prev: boolean) => boolean)) => void;
  templates: TemplatesQuery;
  inserirTemplate: (t: RespostaRapida) => void;
  envio: EnvioApi;
  gravacao: GravacaoApi;
}) {
  const {
    sending,
    sendError,
    enviar,
    onFileSelected,
    onAttachSelected,
    imageInputRef,
    attachInputRef,
  } = envio;
  const {
    recording,
    recordSeconds,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
  } = gravacao;

  // Insere um emoji na posição do cursor do composer (sem dependência nova).
  function inserirEmoji(emoji: string) {
    const el = composeRef.current;
    if (!el) {
      setResposta(resposta + emoji);
      return;
    }
    const start = el.selectionStart ?? resposta.length;
    const end = el.selectionEnd ?? resposta.length;
    setResposta(resposta.slice(0, start) + emoji + resposta.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  // ── Templates: dropdown abre quando o texto começa com "/" (sem espaço) ──
  const mostrarTemplates =
    resposta.startsWith('/') && !resposta.includes(' ') && !resposta.includes('\n');
  const filtroTemplate = mostrarTemplates ? resposta.slice(1).toLowerCase() : '';
  const templatesFiltrados = (templates.data ?? [])
    .filter(
      (t) =>
        t.atalho.toLowerCase().includes(filtroTemplate) ||
        t.titulo.toLowerCase().includes(filtroTemplate),
    )
    .slice(0, 8);

  const c = conv;
  const lockedCompose = c && (c.status === 'RESOLVIDA' || c.status === 'ARQUIVADA');
  // Sprint 2.3 — canal que não aceita resposta de texto livre (Amazon/TikTok/Shopee-devolução).
  const bloqueioCanal = c ? canalSemTextoLivre(c.canal, c.categoria) : { bloqueado: false };

  return (
    <>
      {/* Compose */}
      {/* Sprint 2.3 — banner quando o canal não aceita texto livre (compose oculto) */}
      {c && !lockedCompose && bloqueioCanal.bloqueado && (
        <div
          data-testid="inbox-canal-bloqueado"
          className="px-4 py-3 border-t border-warning/40 bg-warning/10"
        >
          <div className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <strong>Este canal não aceita resposta livre por aqui.</strong>
              <p className="text-text-subtle mt-0.5">{bloqueioCanal.motivo}</p>
            </div>
          </div>
        </div>
      )}

      {c && !lockedCompose && !bloqueioCanal.bloqueado && (
        <div className="px-4 py-3 border-t border-border bg-bg-alt">
          {/* Inputs file escondidos (só clicados pelos botões abaixo).
              Áudio NÃO tem input próprio — usa MediaRecorder (gravação).
              Paperclip aceita qualquer arquivo (inclui áudio gravado externamente). */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onFileSelected(e, 'IMAGE')}
            data-testid="inbox-file-image"
          />
          <input
            ref={attachInputRef}
            type="file"
            accept="*/*"
            hidden
            onChange={onAttachSelected}
            data-testid="inbox-file-attach"
          />

          {/* Estado de gravação ativa: timer + pausar/continuar + cancelar + enviar */}
          {recording !== 'idle' && (
            <div
              className={cn(
                'mb-2 px-3 py-2 rounded-md border flex items-center gap-3',
                recording === 'recording'
                  ? 'bg-danger/10 border-danger/30'
                  : 'bg-warning/10 border-warning/30',
              )}
              data-testid="recording-active"
            >
              {recording === 'recording' ? (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-danger" />
                </span>
              ) : (
                <span className="inline-flex rounded-full h-2.5 w-2.5 bg-warning" />
              )}
              <span
                className={cn(
                  'text-sm tabular font-medium',
                  recording === 'recording' ? 'text-danger' : 'text-warning',
                )}
              >
                {recording === 'recording' ? 'Gravando' : 'Pausado'} —{' '}
                {Math.floor(recordSeconds / 60)}:
                {String(recordSeconds % 60).padStart(2, '0')}
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={cancelRecording}
                className="text-xs px-2 py-1 rounded text-muted hover:text-text hover:bg-surface-hover"
                data-testid="inbox-record-cancel"
              >
                Cancelar
              </button>
              {recording === 'recording' ? (
                <button
                  type="button"
                  onClick={pauseRecording}
                  className="text-xs px-2.5 py-1 rounded border border-border bg-surface hover:bg-surface-hover text-text font-medium"
                  data-testid="inbox-record-pause"
                  title="Pausar gravação"
                >
                  Pausar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={resumeRecording}
                  className="text-xs px-2.5 py-1 rounded border border-border bg-surface hover:bg-surface-hover text-text font-medium"
                  data-testid="inbox-record-resume"
                  title="Continuar gravação"
                >
                  Continuar
                </button>
              )}
              <button
                type="button"
                onClick={stopRecording}
                className="text-xs px-2.5 py-1 rounded bg-primary text-primary-contrast font-medium hover:bg-primary-hover flex items-center gap-1.5"
                data-testid="inbox-record-stop"
              >
                <Square className="h-3 w-3 fill-current" />
                Enviar
              </button>
            </div>
          )}

          {/* Preview "respondendo a…" (quote) acima do composer. */}
          {respondendoA && (
            <div
              data-testid="inbox-reply-preview"
              className="flex items-center gap-2 mb-1.5 pl-2 border-l-2 border-primary bg-surface-elevated rounded px-2 py-1.5"
            >
              <Reply className="h-3.5 w-3.5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="block text-[10px] font-semibold text-primary">
                  Respondendo {respondendoA.direction === 'OUTBOUND' ? 'você mesmo' : 'o contato'}
                </span>
                <span className="block text-xs text-muted truncate">
                  {respondendoA.conteudo || `[${respondendoA.tipo.toLowerCase()}]`}
                </span>
              </div>
              <button
                type="button"
                data-testid="inbox-reply-cancel"
                onClick={() => setRespondendoA(null)}
                className="p-1 rounded text-muted hover:text-text hover:bg-surface-hover shrink-0"
                title="Cancelar resposta"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-1.5">
            {/* Botões de anexar — só pra canal WhatsApp por enquanto */}
            {c.canal === 'WHATSAPP' && (
              <div className="flex items-center gap-1 pb-1">
                <button
                  type="button"
                  data-testid="inbox-attach-image"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={sending || recording !== 'idle'}
                  className="p-2 rounded-md text-muted hover:text-text hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Enviar imagem"
                >
                  <ImageIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-testid="inbox-record-mic"
                  // Mic só inicia gravação. Pausar/Continuar/Cancelar/Enviar
                  // ficam nos botões do banner de gravação (sem ambiguidade).
                  onClick={() => recording === 'idle' && void startRecording()}
                  disabled={sending || recording !== 'idle'}
                  className={cn(
                    'p-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                    recording !== 'idle'
                      ? 'text-danger bg-danger/10'
                      : 'text-muted hover:text-text hover:bg-surface-hover',
                  )}
                  title={
                    recording === 'idle'
                      ? 'Gravar voice note'
                      : 'Gravação em andamento (use o banner acima)'
                  }
                >
                  <Mic className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-testid="inbox-attach-file"
                  onClick={() => attachInputRef.current?.click()}
                  disabled={sending || recording !== 'idle'}
                  className="p-2 rounded-md text-muted hover:text-text hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Anexar arquivo (documento, áudio, vídeo)"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              </div>
            )}
            {/* Emoji — qualquer canal (emoji é só texto). Picker inline, sem lib. */}
            <div className="relative pb-1">
              <button
                type="button"
                data-testid="inbox-emoji-btn"
                onClick={() => setEmojiAberto((v) => !v)}
                disabled={sending}
                className="p-2 rounded-md text-muted hover:text-text hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Emoji"
              >
                <Smile className="h-4 w-4" />
              </button>
              {emojiAberto && (
                <>
                  {/* backdrop pra fechar ao clicar fora */}
                  <button
                    type="button"
                    aria-label="Fechar emojis"
                    className="fixed inset-0 z-20 cursor-default"
                    onClick={() => setEmojiAberto(false)}
                  />
                  <div className="absolute bottom-full left-0 mb-2 w-64 p-2 rounded-md border border-border bg-surface-elevated shadow-lg z-30 grid grid-cols-8 gap-0.5">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => inserirEmoji(e)}
                        className="text-xl leading-none p-1 rounded hover:bg-surface-hover"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="relative flex-1">
              {mostrarTemplates && templatesFiltrados.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-1 max-h-56 overflow-y-auto rounded-md border border-border bg-surface-elevated shadow-lg z-20">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted border-b border-border">
                    Respostas rápidas
                  </div>
                  {templatesFiltrados.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      data-testid={`template-${t.id}`}
                      onClick={() => void inserirTemplate(t)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-hover border-b border-border last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-primary shrink-0">{t.atalho}</code>
                        <span className="text-sm font-medium truncate">{t.titulo}</span>
                      </div>
                      <div className="text-xs text-muted truncate">{t.conteudo}</div>
                    </button>
                  ))}
                </div>
              )}
              <Textarea
                ref={composeRef}
                data-testid="inbox-compose"
                placeholder="Digite sua resposta… (ou / pra respostas rápidas)"
                value={resposta}
                onChange={(e) => setResposta(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void enviar();
                  } else if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
                    // Ctrl/Cmd + / abre o seletor de respostas rápidas.
                    e.preventDefault();
                    setResposta('/');
                  } else if (e.key === 'Escape' && mostrarTemplates) {
                    setResposta('');
                  }
                }}
                className="min-h-[44px] max-h-32 resize-none w-full"
                maxLength={4096}
              />
            </div>
            <Button
              type="button"
              data-testid="inbox-send-btn"
              disabled={sending || resposta.trim().length === 0}
              loading={sending}
              onClick={enviar}
              size="md"
              leftIcon={!sending ? <Send className="h-3.5 w-3.5" /> : undefined}
            >
              Enviar
            </Button>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[11px] text-muted">
              {sendError ? (
                <span className="text-danger">
                  {sendError}
                  {/* Sugere reconectar quando o erro indica desconexão (estado
                      ou pós-tentativa). Connection Closed = socket caiu durante
                      envio; pareado/conectado = check inicial falhou. */}
                  {sendError.includes('pareado') ||
                  sendError.includes('conectado') ||
                  sendError.toLowerCase().includes('connection closed') ||
                  sendError.toLowerCase().includes('socket') ? (
                    <>
                      {' — '}
                      <a
                        href="/whatsapp"
                        className="underline font-medium hover:text-danger-hover"
                      >
                        reconectar agora
                      </a>
                    </>
                  ) : null}
                </span>
              ) : (
                <>⌘/Ctrl + Enter — anexar até 12MB</>
              )}
            </span>
            <span className="text-[11px] text-muted tabular">
              {resposta.length}/4096
            </span>
          </div>
        </div>
      )}

      {c && lockedCompose && (
        <div className="px-4 py-3 border-t border-border bg-bg-alt text-center">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            <CheckCircle2 className="h-4 w-4" />
            Conversa {STATUS_LABEL[c.status].toLowerCase()}. Reabra pra responder.
          </span>
        </div>
      )}
    </>
  );
}
