import { Tag, X } from 'lucide-react';
import { useTagsConversa } from '../hooks/useTagsConversa';
import type { Conversation } from '../lib/types';

/**
 * Item #25 — faixa de tags internas de triagem (só a equipe vê). Chips
 * removíveis + input "+ tag" (Enter adiciona). Extraído do ConversationThread —
 * chama `useTagsConversa` internamente (estado/handlers vivem no hook). Renderiza
 * null enquanto a conversa não carregou (era o guard `{c && (...)}`).
 */
export function BarraTagsTriagem({
  conv,
  id,
  refetchConv,
  onChanged,
}: {
  conv: Conversation | null | undefined;
  id: string;
  refetchConv: () => void;
  onChanged: () => void;
}) {
  const { tagsAtuais, novaTag, setNovaTag, salvando, adicionarTag, removerTag } = useTagsConversa(
    conv,
    id,
    refetchConv,
    onChanged,
  );

  if (!conv) return null;

  return (
    <div
      data-testid="inbox-tags-bar"
      className="px-4 py-2 border-b border-border bg-bg-alt flex items-center gap-1.5 flex-wrap"
    >
      <Tag className="h-3.5 w-3.5 text-muted shrink-0" aria-hidden />
      {tagsAtuais.map((tag) => (
        <span
          key={tag}
          data-testid={`inbox-tag-${tag}`}
          className="inline-flex items-center gap-1 h-[22px] pl-2 pr-1 rounded-full text-[11px] font-semibold bg-primary/15 text-primary border border-primary/25"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remover tag ${tag}`}
            data-testid={`inbox-tag-remove-${tag}`}
            disabled={salvando}
            onClick={() => void removerTag(tag)}
            className="inline-flex items-center justify-center h-4 w-4 rounded-full hover:bg-primary/20 disabled:opacity-40"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {tagsAtuais.length < 12 && (
        <input
          type="text"
          data-testid="inbox-tag-input"
          value={novaTag}
          onChange={(e) => setNovaTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void adicionarTag();
            }
          }}
          disabled={salvando}
          maxLength={30}
          placeholder="+ tag"
          className="h-[22px] min-w-[70px] w-24 px-2 rounded-full text-[11px] bg-surface border border-dashed border-border text-text placeholder:text-muted focus:outline-none focus:border-primary disabled:opacity-40"
        />
      )}
      {tagsAtuais.length === 0 && (
        <span className="text-[11px] text-muted ml-1">
          Etiquetas de triagem internas
        </span>
      )}
    </div>
  );
}
