import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSyncExternalStore } from 'react';
import { getSession, subscribe } from '@/lib/auth-store';
import { api, ApiError } from '@/lib/api';
import { colors } from '@/components/styles';

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
  BAIXA: colors.muted,
  NORMAL: colors.primary,
  ALTA: colors.warning,
  URGENTE: colors.danger,
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
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        data-testid="notif-bell"
        onClick={toggleOpen}
        aria-label={`Notificações${count > 0 ? ` (${count} não lidas)` : ''}`}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 6,
          fontSize: 18,
          position: 'relative',
          lineHeight: 1,
        }}
      >
        🔔
        {count > 0 && (
          <span
            data-testid="notif-count"
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              background: colors.danger,
              color: '#fff',
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              boxShadow: '0 0 0 2px #fff',
            }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="notif-dropdown"
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            width: 340,
            maxHeight: 480,
            background: '#fff',
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(15,23,42,0.15)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <header
            style={{
              padding: '10px 12px',
              borderBottom: `1px solid ${colors.border}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <strong style={{ fontSize: 14 }}>Notificações</strong>
            {count > 0 && (
              <button
                type="button"
                onClick={marcarTodas}
                data-testid="notif-mark-all"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: colors.primary,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Marcar todas como lidas
              </button>
            )}
          </header>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loadingList ? (
              <div style={{ padding: 16, fontSize: 13, color: colors.muted }}>Carregando…</div>
            ) : items.length === 0 ? (
              <div style={{ padding: 24, fontSize: 13, color: colors.muted, textAlign: 'center' }}>
                Nenhuma notificação ainda.
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick(n)}
                  data-testid={`notif-item-${n.id}`}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    background: n.lidaEm ? '#fff' : '#f0f9ff',
                    border: 'none',
                    borderBottom: `1px solid ${colors.border}`,
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      background: prioridadeColor[n.prioridade],
                      marginTop: 6,
                      flexShrink: 0,
                    }}
                    aria-hidden
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: n.lidaEm ? 400 : 600,
                        color: colors.text,
                        marginBottom: 2,
                      }}
                    >
                      {n.titulo}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: colors.muted,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {n.mensagem}
                    </div>
                    <div style={{ fontSize: 10, color: colors.muted, marginTop: 4 }}>
                      {fmtRelativo(n.criadoEm)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <footer
            style={{
              padding: '8px 12px',
              borderTop: `1px solid ${colors.border}`,
              textAlign: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/notificacoes');
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: colors.primary,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Ver todas →
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
