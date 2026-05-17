import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from '@/components/toast';
import { initSentry } from '@/lib/sentry';
import { bootstrapAuthFromBackend } from '@/lib/auth-store';
import './index.css';

initSentry();

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
