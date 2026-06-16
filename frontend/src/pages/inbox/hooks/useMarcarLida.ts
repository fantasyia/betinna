import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import type { Conversation } from '../lib/types';

/**
 * Marca a conversa como lida (best-effort) quando ela carrega e: mudou de id OU
 * ainda tem não-lidas. Usa um ref pra dedup — só faz o POST 1x por conversa
 * enquanto está com naoLidas>0, pra NÃO re-POSTar a cada render/poll de 2s.
 * Falhas são silenciosas (catch vazio). Só efeito, sem retorno.
 */
export function useMarcarLida(convData: Conversation | null | undefined, id: string) {
  const lastMarkRef = useRef<string | null>(null);

  useEffect(() => {
    if (!convData) return;
    if (lastMarkRef.current === id && (convData.naoLidas ?? 0) === 0) return;
    lastMarkRef.current = id;
    void api.post(`/inbox/${id}/marcar-lida`).catch(() => {});
  }, [convData, id]);
}
