import { StateView } from '@/components/StateView';
import type { Canal, Mensagem } from '../lib/types';
import { MessageBubble } from './MessageBubble';

/**
 * Área scrollable de bolhas da thread — extraída do ConversationThread (refactor
 * 2026-06-16). JSX movido VERBATIM.
 *
 * ⚠️ Preserva a ordem do backend ('desc', novas primeiro) e inverte pra ordem
 * cronológica via `[...messages].reverse()`. A mensagem citada (quote) é
 * resolvida por `messages.find` no id local guardado em `meta.respondendoA`.
 * `podeReagir` deriva do canal (só WHATSAPP), igual antes.
 */
export function ThreadMensagens({
  messages,
  loading,
  error,
  refetch,
  canal,
  endRef,
  onReagir,
  onResponder,
}: {
  messages: Mensagem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  canal: Canal | undefined;
  endRef: React.Ref<HTMLDivElement>;
  onReagir: (msgId: string, emoji: string) => void;
  onResponder: (msg: Mensagem) => void;
}) {
  const podeReagir = canal === 'WHATSAPP';
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 bg-bg flex flex-col gap-2">
      <StateView
        loading={loading && messages.length === 0}
        error={error}
        empty={!loading && !error && messages.length === 0}
        emptyMessage="Sem mensagens nesta conversa ainda."
        onRetry={refetch}
      >
        {/* Backend retorna 'desc' (novas primeiro) por causa do cursor de
            paginação (`antesDe`). UI inverte pra ordem cronológica clássica
            de chat: antigas em cima, novas embaixo. */}
        {[...messages].reverse().map((m, i, arr) => {
          const prev = i > 0 ? arr[i - 1] : null;
          const showAuthor =
            !prev || prev.direction !== m.direction || prev.autor?.id !== m.autor?.id;
          // Quote: resolve a msg citada pelo id local guardado em meta.respondendoA.
          const refId = typeof m.meta?.respondendoA === 'string' ? m.meta.respondendoA : null;
          const citada = refId ? (messages.find((x) => x.id === refId) ?? null) : null;
          return (
            <MessageBubble
              key={m.id}
              msg={m}
              showAuthor={!!showAuthor}
              podeReagir={podeReagir}
              onReagir={(emoji) => onReagir(m.id, emoji)}
              onResponder={podeReagir ? () => onResponder(m) : undefined}
              citada={citada}
            />
          );
        })}
        <div ref={endRef} />
      </StateView>
    </div>
  );
}
