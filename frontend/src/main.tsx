import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from '@/components/toast';
import { initSentry } from '@/lib/sentry';
import { bootstrapAuthFromSupabase, startSupabaseAuthSync } from '@/lib/auth-store';
import './index.css';

initSentry();

const root = document.getElementById('root');
if (!root) throw new Error('#root não encontrado no index.html');

// Bootstrap de auth ANTES de renderizar: o SDK lê o refresh_token de
// localStorage (gravado no último login) e troca por um access_token novo.
// Sem await: o App renderiza imediatamente e mostra spinner via
// `isInitializing()` enquanto a sessão é resolvida — evita flash do /login.
// Em paralelo, registra listener pra refresh transparente / logout em outras abas.
const unsubscribeAuthSync = startSupabaseAuthSync();
void bootstrapAuthFromSupabase();

// HMR cleanup do listener pra evitar duplicação em dev
if (import.meta.hot) {
  import.meta.hot.dispose(() => unsubscribeAuthSync());
}

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
