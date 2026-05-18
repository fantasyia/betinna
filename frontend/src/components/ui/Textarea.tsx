import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const textareaVariants = cva(
  [
    'w-full',
    'bg-bg text-text font-sans',
    'border rounded-md px-3 py-2 text-sm',
    'transition-[border-color,box-shadow] duration-100',
    'placeholder:text-muted-light resize-y min-h-[72px]',
    'focus:outline-none',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  ],
  {
    variants: {
      variant: {
        default: 'border-border-strong focus:border-primary focus:shadow-ring',
        error: 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(244,63,94,0.18)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, variant, error, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(textareaVariants({ variant: error ? 'error' : variant }), className)}
      {...props}
    />
  );
});
