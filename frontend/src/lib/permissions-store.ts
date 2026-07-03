/**
 * permissions-store — matriz de permissões VIVA (do banco), por usuário.
 *
 * Fonte: GET /permissions/me (papel + overrides individuais mesclados no backend).
 * É o que faz o menu/rotas OBEDECEREM ao painel "Permissões granulares" — antes o
 * front usava só a PERMISSION_MATRIX fixa e mudanças no painel não sumiam da UI.
 *
 * Revalidação:
 *  - primeira leitura (lazy) quando há sessão;
 *  - ao focar a janela (throttle 30s);
 *  - a cada 60s (converge com o cache do backend);
 *  - imediatamente quando o backend responde 403 (evento 'betinna:perm-refresh',
 *    disparado pelo api.ts) — cobre "admin tirou a permissão agora".
 *
 * Enquanto não carregou (null), os consumidores devem FALHAR ABERTO (mostrar):
 * o backend continua sendo o gate real; esconder tudo durante o load piscaria a UI.
 */
import { api } from '@/lib/api';
import { getSession, subscribe as subscribeAuth } from '@/lib/auth-store';

export interface ModuloPerm {
  ver: boolean;
  editar: boolean;
}

interface PermissoesMeResp {
  role: string;
  permissoes: Array<{ modulo: string; podeVer: boolean; podeEditar: boolean }>;
}

let matriz: Map<string, ModuloPerm> | null = null;
let carregandoPara: string | null = null;
let ultimoFetchEm = 0;
const listeners = new Set<() => void>();

const FOCUS_THROTTLE_MS = 30_000;
const REFRESH_MS = 60_000;

function emit(): void {
  for (const l of listeners) l();
}

/** Snapshot da matriz (null = ainda não carregada). Estável entre emits. */
export function getPermissoes(): Map<string, ModuloPerm> | null {
  return matriz;
}

export function subscribePermissoes(listener: () => void): () => void {
  listeners.add(listener);
  // Lazy-load na primeira assinatura (se já há sessão).
  void refreshPermissoes();
  return () => listeners.delete(listener);
}

/**
 * Recarrega a matriz do backend. Sem sessão → zera. Dedup por usuário em voo.
 * Best-effort: falha de rede mantém a matriz anterior (não apaga o menu).
 */
export async function refreshPermissoes(): Promise<void> {
  const session = getSession();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    if (matriz !== null) {
      matriz = null;
      emit();
    }
    return;
  }
  if (carregandoPara === userId) return;
  carregandoPara = userId;
  try {
    const r = await api.get<PermissoesMeResp>('/permissions/me');
    const next = new Map<string, ModuloPerm>();
    for (const p of r.permissoes) {
      next.set(p.modulo, { ver: p.podeVer, editar: p.podeEditar });
    }
    matriz = next;
    ultimoFetchEm = Date.now();
    emit();
  } catch {
    // silencioso: 401 (deslogando) ou rede — mantém estado anterior
  } finally {
    carregandoPara = null;
  }
}

/** Helper síncrono: o módulo está visível pro usuário atual? (null matriz → true, fail-open na UI) */
export function moduloVisivel(modulo: string): boolean {
  if (!matriz) return true;
  return matriz.get(modulo)?.ver ?? false;
}

// ─── Gatilhos de revalidação (módulo é singleton — efeitos registrados 1x) ──

if (typeof window !== 'undefined') {
  // Sessão mudou (login/logout/troca de empresa) → recarrega/zera.
  subscribeAuth(() => {
    matriz = null;
    emit();
    void refreshPermissoes();
  });

  // Foco na janela (throttled) — pega mudanças feitas pelo admin em outra aba.
  window.addEventListener('focus', () => {
    if (Date.now() - ultimoFetchEm > FOCUS_THROTTLE_MS) void refreshPermissoes();
  });

  // 403 do backend = permissão pode ter sido revogada agora → revalida já.
  window.addEventListener('betinna:perm-refresh', () => {
    void refreshPermissoes();
  });

  // Convergência periódica (espelha o REFRESH_MS do cache do backend).
  const timer = setInterval(() => {
    if (getSession()) void refreshPermissoes();
  }, REFRESH_MS);
  // Vite HMR: não acumular timers.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => clearInterval(timer));
  }
}
