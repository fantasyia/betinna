import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Card — container base do design system.
 *
 * Variantes:
 *  - default: surface + border sutil
 *  - elevated: surface mais alta + shadow md (modal-like)
 *  - interactive: hover state pra cards clicáveis (lista de clientes etc)
 *  - flat: sem border, só bg — pra zonas inferiores
 *
 * Composição:
 *   <Card>
 *     <CardHeader>
 *       <CardTitle>Faturamento</CardTitle>
 *       <CardDescription>Últimos 30 dias</CardDescription>
 *     </CardHeader>
 *     <CardContent>...</CardContent>
 *     <CardFooter>...</CardFooter>
 *   </Card>
 */

const cardVariants = cva('rounded-lg', {
  variants: {
    variant: {
      default: 'bg-surface border border-border shadow-sm',
      elevated: 'bg-surface-elevated border border-border-strong shadow-md',
      interactive: [
        'bg-surface border border-border shadow-sm cursor-pointer',
        'transition-[background,border-color,box-shadow,transform] duration-100',
        'hover:bg-surface-hover hover:border-primary/40 hover:shadow-md',
        'hover:-translate-y-0.5',
      ],
      flat: 'bg-bg-alt',
      outline: 'bg-transparent border border-border-strong',
    },
    padding: {
      none: 'p-0',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-6',
    },
  },
  defaultVariants: {
    variant: 'default',
    padding: 'md',
  },
});

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant, padding, children, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn(cardVariants({ variant, padding }), className)} {...props}>
      {children}
    </div>
  );
});

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, children, ...props }, ref) {
    return (
      <div ref={ref} className={cn('flex flex-col gap-1 mb-4', className)} {...props}>
        {children}
      </div>
    );
  },
);

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, children, ...props }, ref) {
    return (
      <h3
        ref={ref}
        className={cn('text-md font-semibold tracking-tight text-text', className)}
        {...props}
      >
        {children}
      </h3>
    );
  },
);

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, children, ...props }, ref) {
    return (
      <p ref={ref} className={cn('text-sm text-muted', className)} {...props}>
        {children}
      </p>
    );
  },
);

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, children, ...props }, ref) {
    return (
      <div ref={ref} className={cn(className)} {...props}>
        {children}
      </div>
    );
  },
);

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('flex items-center gap-2 pt-4 mt-4 border-t border-border', className)}
        {...props}
      >
        {children}
      </div>
    );
  },
);

export { cardVariants };
