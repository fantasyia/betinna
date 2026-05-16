import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from '@/components/toast';
import { initSentry } from '@/lib/sentry';

initSentry();

const root = document.getElementById('root');
if (!root) throw new Error('#root não encontrado no index.html');

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
