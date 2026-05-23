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

/**
 * HOTPATCH 2026-05-20 — Invalidação de Service Worker velho.
 *
 * SINTOMA OBSERVADO: usuários reportaram "botão Entrar fica em 'Entrando...'
 * pra sempre, nenhuma request aparece no Network, nenhum erro no console".
 *
 * CAUSA: o Service Worker do bundle ANTIGO (registrado em sessões passadas
 * com regras diferentes) continua ATIVO no browser depois do deploy do
 * bundle novo. Como o SW intercepta `fetch` antes dele aparecer no Network
 * tab, e a regra velha pode pendurar a request, o `await fetch` no LoginPage
 * nunca resolve — botão fica "Entrando..." sem timeout original.
 *
 * FIX: quando o SDK PWA detecta que tem um SW velho controlando esta página
 * mas um NOVO está esperando pra assumir, força `skipWaiting` + reload pra
 * destravar imediatamente. Sem isso, user precisaria fechar todos os tabs
 * pra invalidar manualmente.
 *
 * Roda ANTES do `bootstrapAuthFromBackend` pra garantir que o fetch do
 * /auth/refresh use o SW NOVO (com regra `/api/v1/* → NetworkOnly`).
 */
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) {
      if (reg.waiting) {
         
        console.info('[pwa] SW novo aguardando, forçando skipWaiting…');
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }
  }).catch(() => {
    /* sem SW disponível ou erro — silencioso */
  });

  // Quando o SW novo finalmente assume controle, reload pra usar bundle atualizado.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
     
    console.info('[pwa] SW assumiu controle — recarregando página…');
    window.location.reload();
  });
}

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
