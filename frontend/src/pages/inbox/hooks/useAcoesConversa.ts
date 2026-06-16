import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/toast';
import type { ConversationStatus } from '../lib/types';

/**
 * Ações da thread aberta no Inbox — extraído do ConversationThread (refactor
 * 2026-06-16). Reúne os handlers do HEADER da conversa: reagir, mudar status,
 * pausar/religar o bot, override persistente do bot e zerar a conversa.
 *
 * Cada ação chama o backend e revalida via os refetch recebidos por param
 * (`refetchConv`/`refetchMsgs`) + avisa o pai com `onChanged()`. Toasts/mensagens
 * preservados VERBATIM do código antigo. Erros caem no `toast.error` (com a
 * mensagem do `ApiError` quando disponível).
 */
export function useAcoesConversa(
  id: string,
  refetchConv: () => void,
  refetchMsgs: () => void,
  onChanged: () => void,
) {
  const toast = useToast();

  // Reage a uma mensagem (👍 etc.) via WhatsApp; atualiza a bolha depois.
  async function reagir(messageId: string, emoji: string) {
    try {
      await api.post(`/inbox/messages/${messageId}/reagir`, { emoji });
      refetchMsgs();
    } catch (err) {
      toast.error('Falha ao reagir', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function mudarStatus(novo: ConversationStatus) {
    try {
      await api.patch(`/inbox/${id}/status`, { status: novo });
      toast.success('Status atualizado');
      refetchConv();
      onChanged();
    } catch (err) {
      toast.error('Falha ao mudar status', err instanceof ApiError ? err.message : undefined);
    }
  }

  // Fase 2 — pausar/religar o bot Muller nesta conversa específica
  async function alternarBot(acao: 'pausar' | 'religar') {
    try {
      await api.post(`/inbox/${id}/bot/${acao}`, {});
      toast.success(acao === 'pausar' ? 'Bot pausado nesta conversa' : 'Bot religado nesta conversa');
      refetchConv();
      onChanged();
    } catch (err) {
      toast.error('Falha ao alterar o bot', err instanceof ApiError ? err.message : undefined);
    }
  }

  // Override persistente do bot NESTA conversa (independe do global da empresa):
  // true = sempre liga aqui (mesmo com o bot geral desligado) · false = sempre
  // desliga aqui · null = segue a configuração geral. Resolve o caso do Leo de
  // ligar o bot só pra alguns contatos com o global off.
  async function definirBotLigado(ligado: boolean | null) {
    try {
      await api.post(`/inbox/${id}/bot/ligado`, { ligado });
      toast.success(
        ligado === true
          ? 'Bot ligado só nesta conversa'
          : ligado === false
            ? 'Bot desligado só nesta conversa'
            : 'Bot voltou a seguir a configuração geral',
      );
      refetchConv();
      onChanged();
    } catch (err) {
      toast.error('Falha ao alterar o bot', err instanceof ApiError ? err.message : undefined);
    }
  }

  // Zera a conversa: apaga as mensagens da thread (reseta a memória do bot, que
  // monta contexto pelo histórico) e zera não-lidas/precisaHumano. Mantém o contato.
  async function zerarConversa() {
    try {
      const r = await api.delete<{ mensagens: number }>(`/inbox/${id}/mensagens`);
      toast.success(
        'Conversa zerada',
        `${r.mensagens} mensagem(ns) apagada(s) — memória do bot resetada.`,
      );
      refetchMsgs();
      refetchConv();
      onChanged();
    } catch (err) {
      toast.error('Falha ao zerar conversa', err instanceof ApiError ? err.message : undefined);
    }
  }

  return { reagir, mudarStatus, alternarBot, definirBotLigado, zerarConversa };
}
