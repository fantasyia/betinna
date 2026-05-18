import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Label de campo. `required` adiciona asterisco âmbar.
 */
export const Label = forwardRef<
  HTMLLabelElement,
  LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }
>(function Label({ className, children, required, ...props }, ref) {
  return (
    <label
      ref={ref}
      className={cn(
        'block text-xs font-semibold text-text-subtle mb-1.5',
        'select-none',
        className,
      )}
      {...props}
    >
      {children}
      {required && <span className="text-primary ml-0.5">*</span>}
    </label>
  );
});
