import { forwardRef, type InputHTMLAttributes } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Checkbox custom — esconde o native checkbox e renderiza box estilizado.
 * Suporta state indeterminate (visual minus).
 *
 * O <input> fica como overlay transparente (`absolute inset-0 opacity-0`)
 * COBRINDO o box visível — assim clicar no box atinge o input e alterna o
 * estado. (Antes era `sr-only`: input de 1px fora da área visível, então o
 * clique no box `aria-hidden` não chegava no input e nada era selecionado.)
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
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
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
  // Sem label: alvo de toque ≥44px no mobile (compacto no desktop).
  return (
    <label
      className={cn(
        'inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 cursor-pointer',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {inner}
    </label>
  );
});
