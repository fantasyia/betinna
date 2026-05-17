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

  // Trava scroll do body durante modal aberto (evita scroll do conteúdo
  // de fundo em mobile, que é confuso).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const isMobile =
    typeof window !== 'undefined' && window.innerWidth < 768;

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
        // Em mobile: bottom sheet style (alinha embaixo). Em desktop: centro.
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: isMobile ? 0 : '1rem',
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
          // Mobile: bottom sheet com cantos arredondados só em cima
          borderRadius: isMobile ? '12px 12px 0 0' : 8,
          width: '100%',
          maxWidth: isMobile ? '100%' : width,
          maxHeight: isMobile ? '90vh' : '90vh',
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
            padding: isMobile ? '0.875rem 1rem' : '1rem 1.25rem',
            borderBottom: `1px solid ${colors.border}`,
            // Sticky pra header ficar visível durante scroll do conteúdo longo
            position: 'sticky',
            top: 0,
            background: colors.surface,
            zIndex: 1,
          }}
        >
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 18 }}>{title}</h2>
          <button
            type="button"
            data-testid="modal-close"
            onClick={onClose}
            style={{
              ...btnGhost,
              fontSize: 22,
              lineHeight: 1,
              minWidth: 36,
              minHeight: 36,
            }}
            aria-label="Fechar"
          >
            ×
          </button>
        </header>
        <div
          style={{
            padding: isMobile ? '1rem' : '1.25rem',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {children}
        </div>
        {footer && (
          <footer
            style={{
              padding: isMobile ? '0.75rem 1rem' : '0.75rem 1.25rem',
              borderTop: `1px solid ${colors.border}`,
              display: 'flex',
              gap: '0.5rem',
              // Em mobile, botões empilham se faltar espaço (flexWrap reverse
              // mantém o primary à direita acima do secondary)
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              // Sticky footer pra ficar visível em conteúdo longo
              position: 'sticky',
              bottom: 0,
              background: colors.surface,
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
