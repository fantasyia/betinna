import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * IconButton — botão quadrado pra ações de ícone único.
 * Sempre precisa de aria-label (acessibilidade — sem texto visível).
 */
const iconButtonVariants = cva(
  [
    'inline-flex items-center justify-center shrink-0',
    'rounded-md transition-[background,color,border-color] duration-100',
    'focus-visible:outline-none focus-visible:shadow-ring-strong',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  ],
  {
    variants: {
      variant: {
        secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-hover',
        ghost: 'bg-transparent text-text-subtle hover:bg-surface-hover hover:text-text',
        subtle: 'bg-surface-hover text-text border border-border hover:bg-surface-elevated',
        danger: 'bg-transparent text-danger hover:bg-danger/15',
      },
      size: {
        sm: 'h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5',
        md: 'h-8 w-8 [&_svg]:h-4 [&_svg]:w-4',
        lg: 'h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  },
);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  'aria-label': string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, icon, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {icon}
    </button>
  );
});
