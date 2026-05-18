import { useState, type ReactElement, type ReactNode, cloneElement } from 'react';
import { cn } from '@/lib/cn';

/**
 * Tooltip — pure CSS via hover/focus state, sem dependência de Radix.
 *
 * Limita-se a `top` por simplicidade. Pra direções complexas, usar Popover.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
  delay = 200,
}: {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  delay?: number;
}) {
  const [open, setOpen] = useState(false);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  function handleEnter() {
    if (timer) clearTimeout(timer);
    setTimer(setTimeout(() => setOpen(true), delay));
  }

  function handleLeave() {
    if (timer) clearTimeout(timer);
    setOpen(false);
  }

  const wrapped = cloneElement(children, {
    onMouseEnter: handleEnter,
    onMouseLeave: handleLeave,
    onFocus: handleEnter,
    onBlur: handleLeave,
  } as Partial<typeof children.props>);

  const sideClass: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };

  return (
    <span className="relative inline-flex">
      {wrapped}
      {open && content && (
        <span
          role="tooltip"
          className={cn(
            'absolute z-50 px-2 py-1 rounded text-xs font-medium whitespace-nowrap pointer-events-none',
            'bg-surface-elevated text-text border border-border-strong shadow-md',
            'animate-fade-in',
            sideClass[side],
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
