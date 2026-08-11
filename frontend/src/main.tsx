import { StrictMode } from 'react';
import { temAlteracaoNaoSalva } from '@/lib/dirty';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ToastProvider } from '@/components/toast';
import { ApiError } from '@/lib/api';
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
  //
  // AUDITORIA (média): o reload era INCONDICIONAL. Deploy caindo no meio de um
  // editor de fluxo aberto ou de um pedido meio preenchido levava o trabalho
  // embora, sem aviso e sem o usuário entender o motivo. Agora, se houver
  // alteração não salva, adia: recarrega quando a tela ficar limpa, ou na
  // próxima navegação. Bundle velho por mais alguns minutos é bem menos pior
  // que perder o que a pessoa estava fazendo.
  let refreshing = false;
  const recarregar = () => {
    if (refreshing) return;
    refreshing = true;
    console.info('[pwa] SW assumiu controle — recarregando página…');
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!temAlteracaoNaoSalva()) {
      recarregar();
      return;
    }
    console.info('[pwa] nova versão pronta, mas há alteração não salva — reload adiado.');
    // Teto de 30min: se a pessoa deixar a aba aberta com rascunho e for embora,
    // o timer ficava vivo pra sempre pollando de 5 em 5s. Passado o teto,
    // desiste — o reload acontece na próxima navegação, que é o fallback já
    // documentado acima.
    const limite = Date.now() + 30 * 60_000;
    const timer = setInterval(() => {
      if (Date.now() > limite) {
        clearInterval(timer);
        console.info('[pwa] reload adiado expirou — a nova versão entra na próxima navegação.');
        return;
      }
      if (temAlteracaoNaoSalva()) return;
      clearInterval(timer);
      recarregar();
    }, 5_000);
  });
}

// PWA — registra service worker, dispara evento `pwa:needRefresh` quando
// nova versão é detectada. PwaBanner (renderizado pelo App) escuta e mostra
// banner customizado com brandbook. Fallback pra window.confirm caso o
// componente não esteja montado por algum motivo.
void registerPwa({
  onNeedRefresh: (accept) => {
    if (typeof window === 'undefined') return;
    // CAÇADA-BUG #42: o fallback window.confirm rodava SEMPRE, 3s após o banner — o usuário via os
    // DOIS (banner bonito + confirm nativo por cima) a cada deploy. Agora o PwaBanner acusa recebimento
    // (pwa:bannerAck) e cancela o fallback; o confirm só aparece se o banner NÃO montou em 3s.
    let bannerRespondeu = false;
    const onAck = () => {
      bannerRespondeu = true;
    };
    window.addEventListener('pwa:bannerAck', onAck, { once: true });
    window.dispatchEvent(new CustomEvent('pwa:needRefresh', { detail: { accept } }));
    setTimeout(() => {
      window.removeEventListener('pwa:bannerAck', onAck);
      if (bannerRespondeu) return; // banner assumiu → sem confirm nativo
      if (window.confirm('Nova versão do app disponível. Recarregar agora?')) {
        void accept();
      }
    }, 3000);
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root não encontrado no index.html');

// Cache de dados cross-page (TanStack Query). Singleton — criado UMA vez.
// Multi-tenant: trocar de empresa dá window.location.reload() (auth-store),
// o que zera este cache — então dois tenants nunca compartilham dados.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // 1 min "fresco" — navegação rápida reusa sem re-buscar
      gcTime: 5 * 60_000, // 5 min em memória após não-usado
      refetchOnWindowFocus: false, // não re-buscar agressivo ao focar a aba
      retry: (failureCount, error) => {
        // 401 (auth morta) e 4xx (erro do cliente) não retentam; transientes até 2x.
        const status = error instanceof ApiError ? error.status : 0;
        if (status === 401 || (status >= 400 && status < 500)) return false;
        return failureCount < 2;
      },
    },
  },
});

// Bootstrap de auth ANTES de renderizar: chama POST /auth/refresh com o
// cookie httpOnly. Se cookie válido, backend devolve novo access; senão,
// fica sem sessão. Sem await: o App renderiza imediatamente e mostra
// spinner via `isInitializing()` enquanto a sessão é resolvida — evita
// flash do /login.
void bootstrapAuthFromBackend();

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ToastProvider>
  </StrictMode>,
);
