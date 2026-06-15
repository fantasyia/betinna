import type { ReactNode } from 'react';
import { colors } from './styles';
import { cn } from '@/lib/cn';

const INPUT_CLS =
  'w-full border border-border-strong rounded-md px-3 py-2 text-[13px] bg-surface text-text box-border outline-none';

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  required?: boolean;
}

export function FormField({ label, htmlFor, hint, error, required, children }: FormFieldProps) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-semibold uppercase text-muted mb-1.5 tracking-[0.6px]"
      >
        {label}
        {required && <span style={{ color: colors.danger, marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {hint && !error && (
        <p style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{hint}</p>
      )}
      {error && (
        <p data-testid="field-error" style={{ fontSize: 12, color: colors.danger, marginTop: 4 }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(INPUT_CLS, className)} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(INPUT_CLS, '[appearance:auto] [color-scheme:light]', className)} />
  );
}

export function Textarea({
  className,
  style,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(INPUT_CLS, className)}
      style={{ minHeight: 80, fontFamily: 'inherit', ...style }}
    />
  );
}
