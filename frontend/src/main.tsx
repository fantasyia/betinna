import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from '@/components/toast';
import { initSentry } from '@/lib/sentry';
import { bootstrapAuthFromBackend } from '@/lib/auth-store';
import { registerPwa } from '@/lib/pwa';
import { initI18n } from '@/lib/i18n';
import { bootstrapTheme } from '@/hooks/useTheme';
import './index.css';

// Aplica tema (light/dark) ANTES de renderizar pra evitar flash
bootstrapTheme();

initSentry();
initI18n();

// PWA — registra service worker, dispara evento `pwa:needRefresh` quando
// nova versão é detectada. PwaBanner (renderizado pelo App) escuta e mostra
// banner customizado com brandbook. Fallback pra window.confirm caso o
// componente não esteja montado por algum motivo.
void registerPwa({
  onNeedRefresh: (accept) => {
    if (typeof window === 'undefined') return;
    // Emite evento que o componente PwaBanner escuta
    window.dispatchEvent(
      new CustomEvent('pwa:needRefresh', { detail: { accept } }),
    );
    // Fallback caso o banner não monte em 3s
    setTimeout(() => {
      if (window.confirm('Nova versão do app disponível. Recarregar agora?')) {
        void accept();
      }
    }, 3000);
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root não encontrado no index.html');

// Bootstrap de auth ANTES de renderizar: chama POST /auth/refresh com o
// cookie httpOnly. Se cookie válido, backend devolve novo access; senão,
// fica sem sessão. Sem await: o App renderiza imediatamente e mostra
// spinner via `isInitializing()` enquanto a sessão é resolvida — evita
// flash do /login.
void bootstrapAuthFromBackend();

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
