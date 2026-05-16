import type { CSSProperties } from 'react';

/**
 * Tokens de estilo compartilhados — paleta neutra, sem CSS framework.
 * Mantém todas as páginas visualmente coerentes até entrar a reescrita Tailwind.
 */
export const colors = {
  bg: '#f6f7f9',
  surface: '#ffffff',
  border: '#e2e5ea',
  borderStrong: '#cbd0d9',
  text: '#1c1f24',
  muted: '#666',
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  danger: '#dc2626',
  success: '#16a34a',
  warning: '#d97706',
};

export const card: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: '1.25rem',
};

export const btn: CSSProperties = {
  background: colors.primary,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '0.5rem 1rem',
  fontWeight: 500,
  fontSize: 14,
  cursor: 'pointer',
};

export const btnSecondary: CSSProperties = {
  ...btn,
  background: colors.surface,
  color: colors.text,
  border: `1px solid ${colors.borderStrong}`,
};

export const btnDanger: CSSProperties = {
  ...btn,
  background: colors.danger,
};

export const btnGhost: CSSProperties = {
  ...btnSecondary,
  background: 'transparent',
  border: 'none',
  padding: '0.25rem 0.5rem',
};

export const input: CSSProperties = {
  width: '100%',
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: 6,
  padding: '0.5rem 0.75rem',
  fontSize: 14,
  fontFamily: 'inherit',
  background: colors.surface,
  color: colors.text,
  boxSizing: 'border-box',
};

export const select: CSSProperties = {
  ...input,
  appearance: 'auto',
};

export const label: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  color: colors.muted,
  marginBottom: 4,
  letterSpacing: 0.3,
};

export const pageWrap: CSSProperties = {
  padding: '2rem',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  background: colors.bg,
  minHeight: '100vh',
  color: colors.text,
};

export const headerBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '1.5rem',
  gap: '1rem',
  flexWrap: 'wrap',
};

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
};

export const th: CSSProperties = {
  textAlign: 'left',
  padding: '0.75rem 0.75rem',
  borderBottom: `1px solid ${colors.border}`,
  fontWeight: 600,
  color: colors.muted,
  fontSize: 12,
  textTransform: 'uppercase',
  background: '#fafbfc',
  letterSpacing: 0.3,
};

export const td: CSSProperties = {
  padding: '0.75rem 0.75rem',
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: 'middle',
};

export const badge = (color = colors.muted): CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  background: color + '22',
  color,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
});
