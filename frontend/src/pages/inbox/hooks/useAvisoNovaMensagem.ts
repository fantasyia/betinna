import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PaginatedResponse } from '@/hooks/useApiQuery';
import type { Conversation } from '../lib/types';
import { tocarBeep } from '../lib/beep';

/**
 * Sprint 2.3 — aviso ativo de mensagem nova (som + notificação + título da aba).
 * Recebe o resultado paginado da lista; deriva o total de não-lidas e, quando ele
 * SOBE, toca o beep (se ligado) + notifica (se a aba está em 2º plano). No 1º load
 * só fixa o baseline (NÃO avisa) pra não disparar beep/notificação "fantasma".
 * Retorna { somLigado, alternarSom } pro botão de som da toolbar.
 */
export function useAvisoNovaMensagem(
  pageResp: PaginatedResponse<Conversation> | null | undefined,
) {
  const totalNaoLidas = useMemo(
    () => (pageResp?.data ?? []).reduce((s, c) => s + (c.naoLidas ?? 0), 0),
    [pageResp],
  );
  // Chave padronizada no separador ':' (era 'inbox.som'); fallback migra a pref.
  const [somLigado, setSomLigado] = useState(
    () => (localStorage.getItem('inbox:som') ?? localStorage.getItem('inbox.som')) !== 'off',
  );
  const prevNaoLidasRef = useRef(0);
  // No PRIMEIRO load sincronizamos o ref SEM notificar — senão abrir o Inbox já com
  // não-lidas dispararia um beep/notificação "fantasma" (0 → N conta como "subiu").
  const notifInitRef = useRef(false);

  // Pede permissão de notificação 1x.
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  // Quando o total de não-lidas SOBE → toca som + (se a aba está em 2º plano) notifica.
  useEffect(() => {
    if (!pageResp) return; // ignora o estado vazio/loading (não zera o baseline)
    const prev = prevNaoLidasRef.current;
    prevNaoLidasRef.current = totalNaoLidas;
    if (!notifInitRef.current) {
      notifInitRef.current = true; // primeiro load: só fixa o baseline, não avisa
      return;
    }
    if (totalNaoLidas > prev) {
      if (somLigado) tocarBeep();
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification('Nova mensagem · betinna.ai', {
            body: 'Você tem novas mensagens no Inbox.',
          });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        } catch {
          /* ignore */
        }
      }
    }
  }, [totalNaoLidas, somLigado, pageResp]);

  // Badge no título da aba: (N) quando há não-lidas e a aba não está focada.
  useEffect(() => {
    const aplicar = () => {
      document.title =
        totalNaoLidas > 0 && document.hidden ? `(${totalNaoLidas}) betinna.ai` : 'betinna.ai';
    };
    aplicar();
    document.addEventListener('visibilitychange', aplicar);
    return () => {
      document.removeEventListener('visibilitychange', aplicar);
      document.title = 'betinna.ai';
    };
  }, [totalNaoLidas]);

  const alternarSom = useCallback(() => {
    setSomLigado((s) => {
      const novo = !s;
      localStorage.setItem('inbox:som', novo ? 'on' : 'off');
      if (novo) tocarBeep();
      return novo;
    });
  }, []);

  return { somLigado, alternarSom };
}
