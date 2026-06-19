import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Button — primitive principal do design system.
 *
 * Cores via tokens do BRANDBOOK (navy `#201554` primária, magenta `#bd1fbf`,
 * cyan `#2bcae5`) — usa as CSS vars `--primary`/`--danger` etc, não hex cru.
 *
 * Variantes:
 *  - primary: navy sólido (primária do BRANDBOOK) — ação primária, máximo 1 por tela
 *  - secondary: contorno navy — ações de apoio
 *  - ghost: sem fundo — ações terciárias, inline
 *  - danger: vermelho sólido — destrutivas (deletar, cancelar)
 *  - subtle: bg primary-light — toolbar buttons, filtros
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
          'bg-primary text-white font-semibold',
          // Sombra = navy #201554 (rgb 32,21,84) tintado. Antes usava 49,19,124
          // (#31137C, o roxo ERRADO que o BRANDBOOK proíbe).
          'shadow-[0_1px_2px_0_rgba(32,21,84,0.3),inset_0_1px_0_0_rgba(255,255,255,0.15)]',
          'hover:bg-primary-hover hover:shadow-[0_2px_8px_0_rgba(32,21,84,0.35),inset_0_1px_0_0_rgba(255,255,255,0.15)]',
        ],
        secondary: [
          'bg-surface text-primary border border-primary/30 font-semibold',
          'hover:bg-primary/5 hover:border-primary/60',
        ],
        ghost: [
          'bg-transparent text-text-subtle',
          'hover:bg-primary/8 hover:text-primary',
        ],
        danger: [
          'bg-danger text-white font-semibold',
          'shadow-[0_1px_2px_0_rgba(196,60,60,0.3)]',
          'hover:brightness-110 hover:shadow-[0_2px_8px_0_rgba(196,60,60,0.35)]',
        ],
        subtle: [
          'bg-primary-light text-primary border border-primary/20',
          'hover:bg-primary/15 hover:border-primary/40',
        ],
      },
      // #23 — alvo de toque ≥44px no mobile; compacto no desktop (md+).
      size: {
        sm: 'h-11 px-2.5 text-xs md:h-7',
        md: 'h-11 px-3 text-sm md:h-8',
        lg: 'h-11 px-4 text-md md:h-10',
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
