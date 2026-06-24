import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';

/**
 * Drawer — painel lateral. Ideal pra forms longos (Novo Cliente, Editar Pedido)
 * sem sair da página atual.
 *
 * Side: right (default) | left.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'right',
  width = 'md',
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  side?: 'left' | 'right';
  width?: 'sm' | 'md' | 'lg' | 'xl';
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

  const widthClass: Record<string, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-xl',
    xl: 'max-w-2xl',
  };

  return createPortal(
    <div
      data-testid="drawer-overlay"
      // Overlay click NÃO fecha — só ESC e botão X (decisão UX G4).
      className="fixed inset-0 z-[100] flex"
      style={{ backdropFilter: 'blur(6px) saturate(140%)', background: 'rgba(0,0,0,0.6)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'bg-surface-elevated border-border-strong shadow-xl',
          'flex flex-col h-full w-full',
          'animate-fade-in',
          widthClass[width],
          side === 'right' && 'ml-auto border-l',
          side === 'left' && 'mr-auto border-r',
          className,
        )}
      >
        {(title || description) && (
          <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border shrink-0">
            <div className="flex flex-col gap-0.5 min-w-0">
              {title && (
                <h2 className="text-md font-semibold tracking-tight text-text">{title}</h2>
              )}
              {description && <p className="text-sm text-muted">{description}</p>}
            </div>
            <IconButton aria-label="Fechar" variant="ghost" size="sm" icon={<X />} onClick={onClose} />
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-border bg-bg-alt shrink-0 [&>button]:flex-1 sm:[&>button]:flex-none">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
