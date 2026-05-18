import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Select nativo — usa <select> embaixo. Pra autocomplete usa AsyncCombobox.
 *
 * Layout: caret manual (lucide ChevronDown) sobreposto pq browsers
 * estilizam o caret nativo de formas diferentes em dark mode.
 */
const selectVariants = cva(
  [
    'w-full appearance-none',
    'bg-bg text-text font-sans',
    'border rounded-md',
    'transition-[border-color,box-shadow] duration-100',
    'focus:outline-none',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-surface',
    'cursor-pointer pr-8',
  ],
  {
    variants: {
      variant: {
        default: 'border-border-strong focus:border-primary focus:shadow-ring',
        error: 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(244,63,94,0.18)]',
      },
      size: {
        sm: 'h-7 px-2 text-xs',
        md: 'h-8 px-2.5 text-sm',
        lg: 'h-10 px-3 text-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>,
    VariantProps<typeof selectVariants> {
  error?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, variant, size, error, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          selectVariants({ variant: error ? 'error' : variant, size }),
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className={cn(
          'absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted',
          size === 'sm' && 'h-3 w-3',
          (size === 'md' || !size) && 'h-3.5 w-3.5',
          size === 'lg' && 'h-4 w-4',
        )}
      />
    </div>
  );
});

export { selectVariants };
