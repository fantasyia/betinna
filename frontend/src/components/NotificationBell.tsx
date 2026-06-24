import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSyncExternalStore } from 'react';
import { getSession, subscribe } from '@/lib/auth-store';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * NotificationBell — ícone de notificações com dropdown.
 *
 * Polling em 30s pra contagem de não-lidas (endpoint barato).
 * Ao abrir o dropdown, busca os últimos 10 itens.
 * Click no item: marca como lida + navega pro link (se houver).
 */

interface Notificacao {
  id: string;
  tipo: string;
  prioridade: 'BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE';
  titulo: string;
  mensagem: string;
  link: string | null;
  lidaEm: string | null;
  criadoEm: string;
}

interface ListResp {
  data: Notificacao[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  naoLidas: number;
}

const POLL_INTERVAL_MS = 30_000;

function subscribeAuth(cb: () => void) {
  return subscribe(() => cb());
}
function getSnapshot() {
  return getSession();
}

const prioridadeColor: Record<Notificacao['prioridade'], string> = {
  BAIXA: 'var(--muted)',
  NORMAL: 'var(--primary)',
  ALTA: 'var(--warning)',
  URGENTE: 'var(--danger)',
};

function fmtRelativo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

export function NotificationBell() {
  const session = useSyncExternalStore(subscribeAuth, getSnapshot, getSnapshot);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Notificacao[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchCount = useCallback(async () => {
    try {
      const r = await api.get<{ naoLidas: number }>('/notificacoes/nao-lidas');
      setCount(r.naoLidas);
    } catch {
      // Silencioso — polling não deve poluir console
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoadingList(true);
    try {
      const r = await api.get<ListResp>('/notificacoes?page=1&limit=10');
      setItems(r.data);
      setCount(r.naoLidas);
    } catch {
      // ignore
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Polling de contagem
  useEffect(() => {
    if (!session?.user?.id) {
      setCount(0);
      return;
    }
    void fetchCount();
    const id = window.setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [session?.user?.id, fetchCount]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) void fetchList();
  }

  async function marcarLida(id: string) {
    try {
      await api.patch(`/notificacoes/${id}/ler`);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, lidaEm: new Date().toISOString() } : n)));
      setCount((c) => Math.max(0, c - 1));
    } catch {
      // ignore
    }
  }

  async function marcarTodas() {
    try {
      await api.patch('/notificacoes/ler-todas');
      setItems((prev) => prev.map((n) => ({ ...n, lidaEm: n.lidaEm ?? new Date().toISOString() })));
      setCount(0);
    } catch (e) {
      console.warn('falha marcar todas:', e instanceof ApiError ? e.message : e);
    }
  }

  function onItemClick(n: Notificacao) {
    if (!n.lidaEm) void marcarLida(n.id);
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  }

  if (!session?.user?.id) return null;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        data-testid="notif-bell"
        onClick={toggleOpen}
        aria-label={`Notificações${count > 0 ? ` (${count} não lidas)` : ''}`}
        className="relative inline-flex h-10 w-10 md:h-auto md:w-auto items-center justify-center cursor-pointer border-none bg-transparent p-1.5 text-lg leading-none"
      >
        🔔
        {count > 0 && (
          <span
            data-testid="notif-count"
            className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-bg-alt"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="notif-dropdown"
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-[1000] flex max-h-[480px] w-[340px] max-w-[calc(100vw-1.5rem)] flex-col rounded-lg border border-border bg-surface-elevated shadow-lg"
        >
          <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <strong className="text-sm">Notificações</strong>
            {count > 0 && (
              <button
                type="button"
                onClick={marcarTodas}
                data-testid="notif-mark-all"
                className="cursor-pointer border-none bg-transparent text-xs text-primary"
              >
                Marcar todas como lidas
              </button>
            )}
          </header>

          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="p-4 text-[13px] text-muted">Carregando…</div>
            ) : items.length === 0 ? (
              <div className="p-6 text-center text-[13px] text-muted">
                Nenhuma notificação ainda.
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick(n)}
                  data-testid={`notif-item-${n.id}`}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-2 border-b border-border px-3 py-2.5 text-left',
                    n.lidaEm ? 'bg-surface-elevated' : 'bg-primary/5',
                  )}
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: prioridadeColor[n.prioridade] }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'mb-0.5 text-[13px] text-text',
                        n.lidaEm ? 'font-normal' : 'font-semibold',
                      )}
                    >
                      {n.titulo}
                    </div>
                    <div className="truncate text-xs text-muted">{n.mensagem}</div>
                    <div className="mt-1 text-[10px] text-muted">{fmtRelativo(n.criadoEm)}</div>
                  </div>
                </button>
              ))
            )}
          </div>

          <footer className="border-t border-border px-3 py-2 text-center">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/notificacoes');
              }}
              className="cursor-pointer border-none bg-transparent text-xs text-primary"
            >
              Ver todas →
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
