import { useEffect, useRef } from 'react';

/**
 * Rola a thread pra baixo quando chega mensagem nova. Recebe o ID da ÚLTIMA
 * mensagem e SÓ depende dele — CRÍTICO: NUNCA dependa do array de mensagens.
 * Como o polling cria nova referência de array a cada 2s, depender do array
 * chamava scrollIntoView toda hora e arrastava o usuário pra baixo quando ele
 * rolava pra ler msg antiga.
 *
 * Faz scroll imediato + scroll de segurança após ~400ms: necessário porque
 * <audio>/<video> com preload=metadata ainda estão carregando dimensões — quando
 * terminam, expandem altura e empurram layout. Sem o segundo scroll, o último
 * item fica cortado. Retorna `endRef` pra ancorar num <div> no fim da lista.
 */
export function useScrollToBottom(lastMsgId: string | null | undefined) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    const t = setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 400);
    return () => clearTimeout(t);
  }, [lastMsgId]);

  return endRef;
}
