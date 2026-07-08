import { useEffect, useState } from 'react';
import { Download, X, RefreshCw } from 'lucide-react';

/**
 * PwaBanner — banner discreto pra instalação PWA e atualização.
 *
 * Captura dois eventos do navegador:
 *  - `beforeinstallprompt` — só dispara em Chrome/Edge quando o app
 *    atende critérios PWA (manifest válido, SW ativo, HTTPS).
 *  - Evento custom `pwa:needRefresh` (emitido por main.tsx via lib/pwa)
 *    quando nova versão é detectada.
 *
 * Brandbook: magenta CTA + navy background + radius 10px.
 */

const BRAND = {
  navy: '#221551',
  magenta: '#bd1fbf',
  cyan: '#2bcae5',
  offWhite: '#F8F7F2',
} as const;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaBanner() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [needRefresh, setNeedRefresh] = useState<(() => Promise<void>) | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);

  useEffect(() => {
    // 1) Install prompt
    function onBefore(e: Event) {
      e.preventDefault(); // Captura — só mostra quando user clica
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', onBefore);

    // 2) Need refresh (emitido por lib/pwa.ts via custom event)
    function onNeedRefresh(e: Event) {
      const detail = (e as CustomEvent<{ accept: () => Promise<void> }>).detail;
      if (detail?.accept) {
        setNeedRefresh(() => detail.accept);
        // CAÇADA-BUG #42: acusa recebimento — o main.tsx cancela o fallback window.confirm (senão o
        // usuário via o banner bonito E um confirm nativo 3s depois, a cada deploy).
        window.dispatchEvent(new CustomEvent('pwa:bannerAck'));
      }
    }
    window.addEventListener('pwa:needRefresh', onNeedRefresh);

    // Reset banner install se user instalou (app foi adicionado à home)
    function onInstalled() {
      setInstallEvent(null);
    }
    window.addEventListener('appinstalled', onInstalled);

    // Dismiss persistido em localStorage
    try {
      if (localStorage.getItem('pwa:install-dismissed') === '1') {
        setInstallDismissed(true);
      }
    } catch {
      /* localStorage indisponível */
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBefore);
      window.removeEventListener('pwa:needRefresh', onNeedRefresh);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'dismissed') {
      try {
        localStorage.setItem('pwa:install-dismissed', '1');
      } catch {
        /* ignore */
      }
      setInstallDismissed(true);
    }
    setInstallEvent(null);
  }

  function dismissInstall() {
    try {
      localStorage.setItem('pwa:install-dismissed', '1');
    } catch {
      /* ignore */
    }
    setInstallDismissed(true);
  }

  // Prioridade: refresh > install
  const showRefresh = !!needRefresh;
  const showInstall = !showRefresh && !!installEvent && !installDismissed;

  if (!showRefresh && !showInstall) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 9990,
        maxWidth: 480,
        margin: '0 auto',
        background: BRAND.navy,
        color: BRAND.offWhite,
        borderRadius: 10,
        padding: '0.875rem 1rem',
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
        border: `1px solid ${BRAND.cyan}44`,
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        fontFamily: 'var(--font-ui, Cabin, system-ui)',
      }}
    >
      {showRefresh ? (
        <>
          <RefreshCw className="h-5 w-5 shrink-0" style={{ color: BRAND.cyan }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Nova versão disponível</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Atualize pra ter as últimas melhorias.
            </div>
          </div>
          <button
            type="button"
            data-testid="pwa-refresh"
            onClick={() => {
              void needRefresh?.();
              setNeedRefresh(null);
            }}
            style={{
              background: BRAND.magenta,
              color: BRAND.offWhite,
              border: 'none',
              borderRadius: 10,
              padding: '0.5rem 1rem',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: `0 4px 12px ${BRAND.magenta}55`,
            }}
          >
            Atualizar
          </button>
        </>
      ) : (
        <>
          <Download className="h-5 w-5 shrink-0" style={{ color: BRAND.cyan }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Instalar Betinna.ai</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Acesso rápido, funciona offline.
            </div>
          </div>
          <button
            type="button"
            data-testid="pwa-install"
            onClick={handleInstall}
            style={{
              background: BRAND.magenta,
              color: BRAND.offWhite,
              border: 'none',
              borderRadius: 10,
              padding: '0.5rem 1rem',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: `0 4px 12px ${BRAND.magenta}55`,
            }}
          >
            Instalar
          </button>
          <button
            type="button"
            aria-label="Dispensar instalação"
            onClick={dismissInstall}
            style={{
              background: 'transparent',
              border: 'none',
              color: BRAND.offWhite,
              opacity: 0.5,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
