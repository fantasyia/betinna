import { useEffect, useState } from 'react';

/**
 * Relógio regressivo da reserva de estoque (pedido da vitrine, 20 min).
 * `restante` é PURO (testado); `useAgora` só faz a tela andar a cada segundo.
 */
export function restante(
  expiraEm: string | Date | null | undefined,
  agora: number = Date.now(),
): { texto: string; segundos: number; vencido: boolean } | null {
  if (!expiraEm) return null;
  const fim = typeof expiraEm === 'string' ? Date.parse(expiraEm) : expiraEm.getTime();
  if (!Number.isFinite(fim)) return null;
  const segundos = Math.max(0, Math.floor((fim - agora) / 1000));
  const mm = Math.floor(segundos / 60);
  const ss = String(segundos % 60).padStart(2, '0');
  return { texto: `${mm}:${ss}`, segundos, vencido: segundos === 0 };
}

/** Data/hora atual que se atualiza a cada segundo enquanto `ligado`. */
export function useAgora(ligado = true): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ligado) return;
    const t = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [ligado]);
  return agora;
}
