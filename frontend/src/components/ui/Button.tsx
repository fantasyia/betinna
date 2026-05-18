import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Button — primitive principal do design system.
 *
 * Variantes:
 *  - primary: âmbar sólido — ação primária, máximo 1 por tela
 *  - secondary: contorno — ações de apoio
 *  - ghost: sem fundo — ações terciárias, inline
 *  - danger: vermelho sólido — destrutivas (deletar, cancelar)
 *  - subtle: bg surface — toolbar buttons, filtros
 *
 * Sizes: sm (28px), md (32px default), lg (40px)
 *
 * Suporta:
 *  - leftIcon / rightIcon (lucide-react)
 *  - loading (spinner + disabled automático)
 *  - asChild (renderiza como <a> ou outro)
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2',
    'font-medium tracking-tight whitespace-nowrap',
    'rounded-md select-none',
    'transition-[background,color,border-color,box-shadow,transform] duration-100',
    'focus-visible:outline-none focus-visible:shadow-ring-strong',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0',
    'active:translate-y-[0.5px]',
  ],
  {
    variants: {
      variant: {
        primary: [
          'bg-primary text-primary-contrast font-semibold',
          'hover:bg-primary-hover',
        ],
        secondary: [
          'bg-surface text-text border border-border-strong',
          'hover:bg-surface-hover hover:border-muted',
        ],
        ghost: [
          'bg-transparent text-text-subtle',
          'hover:bg-surface-hover hover:text-text',
        ],
        danger: [
          'bg-danger text-white font-semibold',
          'hover:brightness-110',
        ],
        subtle: [
          'bg-surface-hover text-text border border-border',
          'hover:bg-surface-elevated hover:border-border-strong',
        ],
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3 text-sm',
        lg: 'h-10 px-4 text-md',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    fullWidth,
    leftIcon,
    rightIcon,
    loading,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
      )}
      {children}
      {rightIcon && !loading && <span className="inline-flex shrink-0">{rightIcon}</span>}
    </button>
  );
});

export { buttonVariants };
