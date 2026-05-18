import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * EmptyState — quando uma lista/tela está vazia.
 *
 * Não inventa o motivo. Mostra ícone, título, descrição opcional e CTA.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        'rounded-lg border border-dashed border-border-strong bg-bg-alt',
        size === 'sm' && 'py-8 px-4 gap-2',
        size === 'md' && 'py-12 px-6 gap-3',
        size === 'lg' && 'py-20 px-8 gap-4',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full',
            'bg-surface text-muted-light',
            size === 'sm' && 'h-10 w-10 [&>svg]:h-5 [&>svg]:w-5',
            size === 'md' && 'h-12 w-12 [&>svg]:h-6 [&>svg]:w-6',
            size === 'lg' && 'h-16 w-16 [&>svg]:h-8 [&>svg]:w-8',
          )}
        >
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h3
          className={cn(
            'text-text font-semibold tracking-tight',
            size === 'sm' && 'text-sm',
            size === 'md' && 'text-md',
            size === 'lg' && 'text-lg',
          )}
        >
          {title}
        </h3>
        {description && (
          <p
            className={cn(
              'text-text-subtle max-w-md',
              size === 'sm' && 'text-xs',
              (size === 'md' || size === 'lg') && 'text-sm',
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
