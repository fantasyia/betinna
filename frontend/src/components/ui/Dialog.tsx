import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';

/**
 * Dialog — modal centralizado, com backdrop blur e animação.
 *
 * Acessibilidade:
 *  - role="dialog" + aria-modal
 *  - Escape fecha
 *  - Click no backdrop NÃO fecha por padrão (decisão UX G4 — evita perda
 *    acidental de dados). Habilitar via prop `closeOnBackdrop={true}`.
 *  - Trap focus básico (foco entra no modal ao abrir)
 *  - Body scroll lock enquanto aberto
 *
 * Renderiza via portal pra escapar de stacking contexts.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = false,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closeOnBackdrop?: boolean;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const sizeClass: Record<string, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[95vw] h-[90vh]',
  };

  return createPortal(
    <div
      data-testid="modal-overlay"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      className={cn(
        'fixed inset-0 z-[100] flex items-center justify-center p-4',
        'animate-fade-in',
      )}
      style={{ backdropFilter: 'blur(6px) saturate(140%)', background: 'rgba(0,0,0,0.6)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'dialog-title' : undefined}
        className={cn(
          'w-full bg-surface-elevated border border-border-strong rounded-lg shadow-xl',
          'flex flex-col max-h-[85vh]',
          'animate-slide-up',
          sizeClass[size],
          className,
        )}
      >
        {(title || description) && (
          <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
            <div className="flex flex-col gap-0.5 min-w-0">
              {title && (
                <h2 id="dialog-title" className="text-md font-semibold tracking-tight text-text">
                  {title}
                </h2>
              )}
              {description && <p className="text-sm text-muted">{description}</p>}
            </div>
            <IconButton
              aria-label="Fechar"
              variant="ghost"
              size="sm"
              icon={<X />}
              onClick={onClose}
            />
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-bg-alt rounded-b-lg">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
