import { forwardRef, type InputHTMLAttributes } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Checkbox custom — esconde o native checkbox e renderiza box estilizado.
 * Suporta state indeterminate (visual minus).
 */
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  indeterminate?: boolean;
  label?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, indeterminate, label, checked, disabled, ...props },
  ref,
) {
  const inner = (
    <span className="relative inline-flex shrink-0">
      <input
        ref={(node) => {
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
          if (node) node.indeterminate = !!indeterminate;
        }}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          'flex h-4 w-4 items-center justify-center',
          'rounded border border-border-strong bg-bg',
          'transition-[background,border-color] duration-100',
          'peer-checked:bg-primary peer-checked:border-primary',
          'peer-indeterminate:bg-primary peer-indeterminate:border-primary',
          'peer-disabled:opacity-50 peer-disabled:cursor-not-allowed',
          'peer-focus-visible:shadow-ring-strong',
          'cursor-pointer',
          className,
        )}
      >
        {indeterminate ? (
          <Minus className="h-2.5 w-2.5 text-primary-contrast" strokeWidth={3} />
        ) : (
          checked && <Check className="h-2.5 w-2.5 text-primary-contrast" strokeWidth={3} />
        )}
      </span>
    </span>
  );
  if (label) {
    return (
      <label className={cn('inline-flex items-center gap-2 cursor-pointer', disabled && 'cursor-not-allowed opacity-50')}>
        {inner}
        <span className="text-sm text-text">{label}</span>
      </label>
    );
  }
  return inner;
});
