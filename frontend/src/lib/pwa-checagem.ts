/**
 * Aba parada não descobre deploy: o navegador só confere atualização do SW em
 * page load, e SPA não tem. Sem isto, a aba aberta de manhã roda a versão de
 * manhã até alguém navegar pra uma rota cujo chunk já sumiu (BETINNA-FRONT-8).
 * Só confere com a aba visível e online — aba escondida não precisa, e offline
 * a checagem só falha.
 */
export const INTERVALO_CHECAGEM_MS = 30 * 60_000;
export function agendarChecagemDeVersao(
  reg: { update: () => Promise<unknown> },
  intervaloMs = INTERVALO_CHECAGEM_MS,
): () => void {
  const id = setInterval(() => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    reg.update().catch(() => undefined);
  }, intervaloMs);
  return () => clearInterval(id);
}
