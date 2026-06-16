import { useState } from 'react';
import {
  Image as ImageIcon,
  FileText,
  Video,
  Mic,
  Reply,
  Smile,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Mensagem } from '../lib/types';
import { fmtTime, fmtHHMM } from '../lib/format';
import {
  MessageMediaImage,
  MessageMediaVideo,
  MessageMediaAudio,
  MessageMediaDocument,
} from './MessageMedia';

export function MessageBubble({
  msg,
  showAuthor,
  podeReagir,
  onReagir,
  onResponder,
  citada,
}: {
  msg: Mensagem;
  showAuthor: boolean;
  podeReagir?: boolean;
  onReagir?: (emoji: string) => void;
  onResponder?: () => void;
  citada?: Mensagem | null;
}) {
  const outbound = msg.direction === 'OUTBOUND';
  const reacao = typeof msg.meta?.reacao === 'string' ? msg.meta.reacao : null;
  // Em mensagens INBOUND vindas de GRUPO, meta.senderName tem o nome do
  // membro que mandou (ex: "João Silva"). Mostra acima da bolha pra dar
  // contexto de quem é o autor.
  const groupSender = !outbound ? msg.meta?.senderName : undefined;
  const MediaIcon = msg.tipo === 'IMAGE'
    ? ImageIcon
    : msg.tipo === 'VIDEO'
      ? Video
      : msg.tipo === 'AUDIO'
        ? Mic
        : msg.tipo === 'DOCUMENT'
          ? FileText
          : null;

  return (
    <div
      data-testid={`msg-${msg.id}`}
      className={cn('flex items-end gap-1 group', outbound ? 'justify-end' : 'justify-start')}
    >
      {(podeReagir || onResponder) && outbound && (
        <MsgActions
          msgId={msg.id}
          onReagir={podeReagir ? onReagir : undefined}
          onResponder={onResponder}
        />
      )}
      <div className="flex flex-col gap-0.5 max-w-[78%]">
        {showAuthor && msg.autor?.nome && (
          <span
            className={cn(
              'text-[10px] text-muted px-1',
              outbound ? 'text-right' : 'text-left',
            )}
          >
            {msg.autor.nome}
          </span>
        )}
        {/* Grupo: nome do membro acima da bolha (estilo WhatsApp) */}
        {groupSender && (
          <span
            className="text-[11px] font-semibold text-primary px-1"
            data-testid={`msg-group-sender-${msg.id}`}
          >
            {groupSender}
          </span>
        )}
        <div
          className={cn(
            'px-3 py-2 text-sm leading-relaxed',
            'border',
            outbound
              ? 'bg-primary/10 text-text border-primary/20 rounded-2xl rounded-br-sm'
              : 'bg-surface text-text border-border rounded-2xl rounded-bl-sm',
          )}
        >
          {/* Quote: trecho da mensagem citada, dentro da bolha (estilo WhatsApp). */}
          {citada && (
            <div
              data-testid={`msg-quote-${msg.id}`}
              className="mb-1.5 pl-2 border-l-2 border-primary/60 bg-black/10 rounded px-2 py-1"
            >
              <span className="block text-[10px] font-semibold text-primary">
                {citada.direction === 'OUTBOUND'
                  ? 'Você'
                  : (citada.meta?.senderName ?? 'Contato')}
              </span>
              <span className="block text-xs text-muted truncate max-w-[240px]">
                {citada.conteudo || `[${citada.tipo.toLowerCase()}]`}
              </span>
            </div>
          )}
          {/* Mídia renderizada inline quando temos mediaUrl pra IMAGE/VIDEO/AUDIO/DOCUMENT.
              Sem mediaUrl, mostra só o ícone + tipo (fallback). */}
          {(() => {
            const hasMedia = !!msg.mediaUrl;
            const isMediaType =
              msg.tipo === 'IMAGE' ||
              msg.tipo === 'VIDEO' ||
              msg.tipo === 'AUDIO' ||
              msg.tipo === 'DOCUMENT';
            // Cabeçalho com ícone + tipo só quando NÃO temos o player real
            // (pra IMAGE/VIDEO/AUDIO/DOCUMENT) — pra outros tipos (LOCATION,
            // CONTACT, STICKER) sempre mostra cabeçalho.
            const showHeader = msg.tipo !== 'TEXT' && MediaIcon && !(isMediaType && hasMedia);
            return (
              <>
                {showHeader && (
                  <div className="flex items-center gap-1.5 mb-1 text-xs text-muted">
                    <MediaIcon className="h-3.5 w-3.5" />
                    <span className="lowercase">{msg.tipo}</span>
                    {msg.mediaMime && (
                      <span className="text-muted-light">· {msg.mediaMime}</span>
                    )}
                  </div>
                )}
                {hasMedia && msg.tipo === 'IMAGE' && <MessageMediaImage msgId={msg.id} />}
                {hasMedia && msg.tipo === 'VIDEO' && <MessageMediaVideo msgId={msg.id} />}
                {hasMedia && msg.tipo === 'AUDIO' && <MessageMediaAudio msgId={msg.id} />}
                {hasMedia && msg.tipo === 'DOCUMENT' && (
                  <MessageMediaDocument msgId={msg.id} fileName={msg.conteudo ?? undefined} />
                )}
              </>
            );
          })()}
          {/* Esconde placeholders "[imagem]"/"[vídeo]"/"[áudio]"/"[documento]" e
              também o fileName cru de DOCUMENT (já mostrado pelo player) quando
              o player real está renderizado acima. */}
          {msg.conteudo &&
            !(
              msg.mediaUrl &&
              (msg.conteudo === '[imagem]' ||
                msg.conteudo === '[vídeo]' ||
                msg.conteudo === '[áudio]' ||
                msg.tipo === 'DOCUMENT')
            ) && <p className="m-0 whitespace-pre-wrap">{msg.conteudo}</p>}
        </div>
        {/* Reação enviada na mensagem (estilo WhatsApp, na borda da bolha). */}
        {reacao && (
          <span className={cn('-mt-2 px-1 z-10', outbound ? 'self-end' : 'self-start')}>
            <span
              className="inline-block rounded-full border border-border bg-surface-elevated px-1.5 py-0.5 text-sm leading-none shadow-sm"
              data-testid={`msg-reacao-${msg.id}`}
            >
              {reacao}
            </span>
          </span>
        )}
        <span
          className={cn(
            'text-[10px] text-muted px-1 tabular flex items-center gap-1',
            outbound ? 'justify-end' : 'justify-start',
          )}
          title={fmtTime(msg.criadoEm)}
        >
          {/* Fase 2 — marca mensagens respondidas automaticamente pelo bot Muller */}
          {msg.enviadaPorBot && (
            <span
              className="text-[10px] font-semibold text-primary"
              data-testid={`msg-bot-tag-${msg.id}`}
              title="Resposta automática do bot Muller"
            >
              🤖 Muller ·
            </span>
          )}
          {fmtHHMM(msg.criadoEm)}
        </span>
      </div>
      {(podeReagir || onResponder) && !outbound && (
        <MsgActions
          msgId={msg.id}
          onReagir={podeReagir ? onReagir : undefined}
          onResponder={onResponder}
        />
      )}
    </div>
  );
}

// Botão de reagir (aparece no hover da mensagem) + mini-picker de reações.
function ReactButton({ onReagir }: { onReagir?: (emoji: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const REACOES = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  if (!onReagir) return null;
  return (
    <div className="relative opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
      <button
        type="button"
        data-testid="msg-reagir-btn"
        onClick={() => setAberto((v) => !v)}
        className="p-1 rounded-full text-muted hover:text-text hover:bg-surface-hover"
        title="Reagir"
      >
        <Smile className="h-3.5 w-3.5" />
      </button>
      {aberto && (
        <>
          <button
            type="button"
            aria-label="Fechar reações"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setAberto(false)}
          />
          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-30 flex gap-0.5 p-1 rounded-full border border-border bg-surface-elevated shadow-lg">
            {REACOES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onReagir(e);
                  setAberto(false);
                }}
                className="text-lg leading-none p-1 rounded-full hover:bg-surface-hover"
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Ações da mensagem no hover: Responder (citar) + Reagir.
function MsgActions({
  msgId,
  onReagir,
  onResponder,
}: {
  msgId: string;
  onReagir?: (emoji: string) => void;
  onResponder?: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 self-center">
      {onResponder && (
        <button
          type="button"
          data-testid={`msg-responder-${msgId}`}
          onClick={onResponder}
          title="Responder"
          className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity p-1 rounded-full text-muted hover:text-text hover:bg-surface-hover"
        >
          <Reply className="h-3.5 w-3.5" />
        </button>
      )}
      {onReagir && <ReactButton onReagir={onReagir} />}
    </div>
  );
}
