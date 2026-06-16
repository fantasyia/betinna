import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/toast';
import type { Conversation } from '../lib/types';

/**
 * Item #25 — tags de triagem internas (só a equipe vê). Extraído do
 * ConversationThread. O backend troca a LISTA INTEIRA no PUT /inbox/:id/tags —
 * por isso cada operação recalcula o array completo e manda tudo.
 *
 * `tagsAtuais` = `convData?.tagsInternas ?? []`. Após salvar, revalida via
 * `refetchConv()` + avisa o pai com `onChanged()` (a lista canônica volta do
 * refetch). Limites preservados do código antigo: tag <= 30 chars, máx 12 tags,
 * dedup case-insensitive.
 */
export function useTagsConversa(
  convData: Conversation | null | undefined,
  id: string,
  refetchConv: () => void,
  onChanged: () => void,
) {
  const toast = useToast();
  const [novaTag, setNovaTag] = useState('');
  const [salvando, setSalvando] = useState(false);

  const tagsAtuais = convData?.tagsInternas ?? [];

  async function salvarTags(tags: string[]) {
    setSalvando(true);
    try {
      const resp = await api.put<{ tagsInternas: string[] }>(`/inbox/${id}/tags`, { tags });
      // Reflete a lista canônica devolvida pelo backend (refetch traz o resto).
      refetchConv();
      onChanged();
      return resp.tagsInternas;
    } catch (err) {
      toast.error('Falha ao salvar tags', err instanceof ApiError ? err.message : undefined);
      return null;
    } finally {
      setSalvando(false);
    }
  }

  async function adicionarTag() {
    const t = novaTag.trim();
    if (!t) return;
    if (t.length > 30) {
      toast.error('Tag muito longa', 'Use até 30 caracteres.');
      return;
    }
    if (tagsAtuais.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setNovaTag('');
      return;
    }
    if (tagsAtuais.length >= 12) {
      toast.error('Limite de tags', 'Máximo de 12 tags por conversa.');
      return;
    }
    const ok = await salvarTags([...tagsAtuais, t]);
    if (ok) setNovaTag('');
  }

  async function removerTag(tag: string) {
    await salvarTags(tagsAtuais.filter((x) => x !== tag));
  }

  return { tagsAtuais, novaTag, setNovaTag, salvando, adicionarTag, removerTag };
}
