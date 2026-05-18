import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Badge } from './Badge';

/**
 * Tabs — simple controlled component. Sem context API (cada uso é leve).
 *
 * <Tabs value={tab} onChange={setTab}>
 *   <Tab value="todos" label="Todos" />
 *   <Tab value="wa" label="WhatsApp" count={3} />
 * </Tabs>
 *
 * Variants:
 *  - underline: linha embaixo da tab ativa (padrão)
 *  - pills: pill âmbar na tab ativa
 */

export interface TabItem {
  value: string;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
}

export function Tabs({
  items,
  value,
  onChange,
  variant = 'underline',
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (v: string) => void;
  variant?: 'underline' | 'pills';
  className?: string;
}) {
  if (variant === 'pills') {
    return (
      <div className={cn('inline-flex items-center gap-1 p-1 bg-bg-alt rounded-md border border-border', className)}>
        {items.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              disabled={tab.disabled}
              onClick={() => onChange(tab.value)}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-3',
                'rounded text-xs font-medium',
                'transition-colors duration-100',
                'focus-visible:outline-none focus-visible:shadow-ring-strong',
                active
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-subtle hover:text-text hover:bg-surface-hover',
                tab.disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              {tab.icon}
              {tab.label}
              {typeof tab.count === 'number' && tab.count > 0 && (
                <Badge size="sm" variant={active ? 'primary' : 'neutral'}>
                  {tab.count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // Variant: underline
  return (
    <div className={cn('flex items-center gap-1 border-b border-border', className)}>
      {items.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            disabled={tab.disabled}
            onClick={() => onChange(tab.value)}
            className={cn(
              'relative inline-flex items-center gap-1.5 h-9 px-3',
              'text-sm font-medium border-b-2 -mb-px',
              'transition-colors duration-100',
              'focus-visible:outline-none focus-visible:shadow-ring',
              active
                ? 'text-text border-primary'
                : 'text-text-subtle border-transparent hover:text-text hover:border-border-strong',
              tab.disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {tab.icon}
            {tab.label}
            {typeof tab.count === 'number' && tab.count > 0 && (
              <Badge size="sm" variant={active ? 'primary' : 'neutral'}>
                {tab.count}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
