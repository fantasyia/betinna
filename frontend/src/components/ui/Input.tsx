import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Input — text/email/tel/number/etc.
 *
 * Suporta:
 *  - leftIcon / rightIcon (lucide-react)
 *  - error state (border vermelha + ring)
 *  - sizes sm/md/lg
 */
const inputVariants = cva(
  [
    'flex w-full items-center',
    'bg-bg text-text font-sans',
    'border rounded-md',
    'transition-[border-color,box-shadow] duration-100',
    'placeholder:text-muted-light',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-surface',
    'focus:outline-none',
  ],
  {
    variants: {
      variant: {
        default: 'border-border-strong focus:border-primary focus:shadow-ring',
        error: 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(244,63,94,0.18)]',
      },
      size: {
        sm: 'h-7 text-xs',
        md: 'h-8 text-sm',
        lg: 'h-10 text-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, variant, size, leftIcon, rightIcon, error, ...props },
  ref,
) {
  const effectiveVariant = error ? 'error' : variant;
  const hasLeftIcon = !!leftIcon;
  const hasRightIcon = !!rightIcon;
  const padX = size === 'lg' ? 12 : size === 'sm' ? 8 : 10;

  if (!hasLeftIcon && !hasRightIcon) {
    return (
      <input
        ref={ref}
        className={cn(inputVariants({ variant: effectiveVariant, size }), className)}
        style={{ paddingLeft: padX, paddingRight: padX, ...props.style }}
        {...props}
      />
    );
  }

  return (
    <div
      className={cn(
        inputVariants({ variant: effectiveVariant, size }),
        'gap-2 px-2',
        'focus-within:border-primary focus-within:shadow-ring',
        error && 'focus-within:shadow-[0_0_0_3px_rgba(244,63,94,0.18)]',
        className,
      )}
    >
      {leftIcon && (
        <span className="inline-flex shrink-0 text-muted [&>svg]:h-3.5 [&>svg]:w-3.5">
          {leftIcon}
        </span>
      )}
      <input
        ref={ref}
        {...props}
        className="flex-1 min-w-0 bg-transparent outline-none border-none p-0 placeholder:text-muted-light"
      />
      {rightIcon && (
        <span className="inline-flex shrink-0 text-muted [&>svg]:h-3.5 [&>svg]:w-3.5">
          {rightIcon}
        </span>
      )}
    </div>
  );
});

export { inputVariants };
