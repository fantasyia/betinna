import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * PwaBanner — aviso de NOVA VERSÃO disponível.
 *
 * Escuta o evento custom `pwa:needRefresh` (emitido por main.tsx via lib/pwa)
 * quando o Service Worker detecta bundle novo, e oferece atualizar sem o usuário
 * precisar de hard refresh.
 *
 * ⚠️ O convite de INSTALAÇÃO ("Instalar Betinna.ai · funciona offline") saiu em
 * 2026-08-20, a pedido do Léo: o app é **somente online**. Ele depende de API,
 * WhatsApp, fila e banco a cada tela — instalado no celular ele não fica
 * "funcionando offline", fica quebrado de um jeito pior, porque parece um app
 * nativo e não avisa que perdeu a rede. Prometer offline no banner era promessa
 * que o app não cumpre.
 *
 * O Service Worker CONTINUA registrado — é ele que detecta versão nova e evita
 * o bundle velho preso no browser (problema real que já mordeu neste projeto).
 * O que saiu foi só o convite de instalar.
 *
 * Brandbook: magenta CTA + navy background + radius 10px.
 */

const BRAND = {
  navy: '#221551',
  magenta: '#bd1fbf',
  cyan: '#2bcae5',
  offWhite: '#F8F7F2',
} as const;

export function PwaBanner() {
  const [needRefresh, setNeedRefresh] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
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
    return () => window.removeEventListener('pwa:needRefresh', onNeedRefresh);
  }, []);

  if (!needRefresh) return null;

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
      <RefreshCw className="h-5 w-5 shrink-0" style={{ color: BRAND.cyan }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Nova versão disponível</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Atualize pra ter as últimas melhorias.</div>
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
    </div>
  );
}
