import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { colors } from './styles';

/**
 * Toast notification system — sem deps externas.
 *
 * Uso:
 *   const toast = useToast();
 *   toast.success('Cliente salvo');
 *   toast.error('Falha ao salvar', err.message);
 *   toast.info('Sync OMIE iniciado');
 *
 * Renderização no root via <ToastProvider>:
 *   <ToastProvider>
 *     <RouterProvider router={router} />
 *   </ToastProvider>
 */

type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  /** Quando true, fica até o user fechar. Default false. */
  sticky?: boolean;
}

interface ToastContextValue {
  push: (t: Omit<ToastItem, 'id'>) => string;
  dismiss: (id: string) => void;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_COLOR: Record<ToastKind, string> = {
  success: colors.success,
  error: colors.danger,
  info: '#0891b2',
  warning: colors.warning,
};

const KIND_ICON: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
  info: 'ⓘ',
  warning: '⚠',
};

const DEFAULT_TTL_MS = 4000;
const ERROR_TTL_MS = 7000; // erro fica mais tempo pra usuário ler

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((arr) => arr.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = Math.random().toString(36).slice(2);
      const item: ToastItem = { id, ...t };
      setToasts((arr) => [...arr, item]);
      if (!t.sticky) {
        const ttl = t.kind === 'error' ? ERROR_TTL_MS : DEFAULT_TTL_MS;
        setTimeout(() => dismiss(id), ttl);
      }
      return id;
    },
    [dismiss],
  );

  const value: ToastContextValue = {
    push,
    dismiss,
    success: (title, description) => push({ kind: 'success', title, description }),
    error: (title, description) =>
      push({ kind: 'error', title, description }),
    info: (title, description) => push({ kind: 'info', title, description }),
    warning: (title, description) =>
      push({ kind: 'warning', title, description }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      data-testid="toast-container"
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        maxWidth: 380,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // Trigger entrada animada
    const t = setTimeout(() => setShow(true), 10);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      data-testid={`toast-${toast.kind}`}
      role="alert"
      style={{
        background: '#fff',
        border: `1px solid ${colors.border}`,
        borderLeft: `4px solid ${KIND_COLOR[toast.kind]}`,
        borderRadius: 6,
        padding: '0.625rem 0.75rem',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.5rem',
        pointerEvents: 'auto',
        transform: show ? 'translateX(0)' : 'translateX(120%)',
        opacity: show ? 1 : 0,
        transition: 'transform 0.2s, opacity 0.2s',
        minWidth: 280,
      }}
    >
      <span
        style={{
          background: KIND_COLOR[toast.kind],
          color: '#fff',
          width: 22,
          height: 22,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {KIND_ICON[toast.kind]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{toast.title}</div>
        {toast.description && (
          <div style={{ fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 1.4 }}>
            {toast.description}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Fechar"
        style={{
          background: 'transparent',
          border: 'none',
          color: colors.muted,
          fontSize: 16,
          cursor: 'pointer',
          padding: 0,
          lineHeight: 1,
          marginLeft: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}

/**
 * Helper pra usar fora de componentes React (ex: api error handler).
 * Cuidado: só funciona depois do <ToastProvider> montar.
 */
let globalToastRef: ToastContextValue | null = null;
export function setGlobalToast(t: ToastContextValue) {
  globalToastRef = t;
}
export function globalToast(): ToastContextValue | null {
  return globalToastRef;
}
