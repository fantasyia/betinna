import type { ReactNode } from 'react';
import { colors, input as inputStyle, label as labelStyle, select as selectStyle } from './styles';

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
      <label htmlFor={htmlFor} style={labelStyle}>
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

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...inputStyle, ...(props.style ?? {}) }} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} style={{ ...selectStyle, ...(props.style ?? {}) }} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{ ...inputStyle, minHeight: 80, fontFamily: 'inherit', ...(props.style ?? {}) }}
    />
  );
}
