/**
 * PWA — registro do service worker via vite-plugin-pwa.
 *
 * Estratégia `registerType: 'prompt'`:
 *  - SW registra automaticamente no primeiro carregamento
 *  - Quando novo deploy é detectado (precache atualizado), o callback
 *    `onNeedRefresh` dispara — mostramos toast pedindo recarregar
 *  - User clica no botão → `updateSW()` aplica a nova versão
 *
 * Em modo dev (npm run dev), o PWA fica desligado (devOptions.enabled=false)
 * pra não interferir com HMR.
 */

interface RegisterPwaArgs {
  /** Callback quando há nova versão disponível pra recarregar. */
  onNeedRefresh: (acceptUpdate: () => Promise<void>) => void;
  /** Callback quando app está pronto pra uso offline. */
  onOfflineReady?: () => void;
  /** Callback quando registro falha (browser sem SW, etc). Best-effort no-op. */
  onError?: (err: unknown) => void;
}

export async function registerPwa(args: RegisterPwaArgs): Promise<void> {
  // Import dinâmico — virtual:pwa-register só existe quando vite-plugin-pwa
  // está ativo (build de produção). Em dev fica undefined; ignoramos.
  try {
    const { registerSW } = await import(
      // @ts-expect-error — módulo virtual gerado pelo vite-plugin-pwa
      'virtual:pwa-register'
    );

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        args.onNeedRefresh(async () => {
          await updateSW(true);
        });
      },
      onOfflineReady() {
        args.onOfflineReady?.();
      },
      onRegisterError(err: unknown) {
        args.onError?.(err);
      },
    });
  } catch (err) {
    // Módulo virtual não existe (dev mode ou plugin desligado) — silencioso
    args.onError?.(err);
  }
}
