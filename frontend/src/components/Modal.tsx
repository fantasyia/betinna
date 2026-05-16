import { useEffect, type ReactNode } from 'react';
import { btnGhost, colors } from './styles';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/**
 * Modal acessível minimalista — overlay click + ESC fecham.
 * Sem portal pra evitar deps; usa fixed positioning.
 */
export function Modal({ open, onClose, title, children, footer, width = 520 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="modal-overlay"
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        data-testid="modal-content"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surface,
          borderRadius: 8,
          width: '100%',
          maxWidth: width,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.25rem',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button
            type="button"
            data-testid="modal-close"
            onClick={onClose}
            style={{ ...btnGhost, fontSize: 20, lineHeight: 1 }}
            aria-label="Fechar"
          >
            ×
          </button>
        </header>
        <div style={{ padding: '1.25rem', overflowY: 'auto' }}>{children}</div>
        {footer && (
          <footer
            style={{
              padding: '0.75rem 1.25rem',
              borderTop: `1px solid ${colors.border}`,
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'flex-end',
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
