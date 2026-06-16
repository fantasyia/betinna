import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Item #25 fatia 4 — heartbeat de presença ao vivo. Enquanto a conversa `id`
 * está aberta, avisa o backend que estou aqui (imediatamente + a cada 20s) e
 * guarda quem MAIS está na conversa agora (exceto eu). No cleanup (troca de
 * conversa/desmontar), sai best-effort usando o `id` CAPTURADO no escopo do
 * efeito — não o da próxima conversa. Falhas são silenciosas (background, sem toast).
 * Retorna `outros` pro banner de aviso e pra confirmação antes de enviar.
 */
export function usePresencaConversa(id: string) {
  const [outros, setOutros] = useState<Array<{ id: string; nome: string }>>([]);

  useEffect(() => {
    // Flag local pra não dar setState após desmontar/trocar de conversa.
    let ativo = true;
    const ping = () => {
      api
        .post<{ outros: Array<{ id: string; nome: string }> }>(`/inbox/${id}/presenca`)
        .then((r) => {
          if (ativo) setOutros(r.outros ?? []);
        })
        .catch(() => {});
    };
    ping();
    const i = setInterval(ping, 20_000);
    return () => {
      ativo = false;
      clearInterval(i);
      setOutros([]);
      // Usa o `id` capturado no escopo deste efeito (não o da próxima conversa).
      api.delete(`/inbox/${id}/presenca`).catch(() => {});
    };
  }, [id]);

  return outros;
}
