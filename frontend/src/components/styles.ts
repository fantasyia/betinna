import type { CSSProperties } from 'react';

/**
 * Design tokens — paleta refinada estilo Linear/Notion.
 *
 * Polish 2026-05-16:
 *  - Paleta mais quente e moderna (neutros com matiz azul-cinza)
 *  - Sombras em camadas (sm/md/lg) em vez de bordas fortes
 *  - Spacing scale consistente (4/8/12/16/24/32)
 *  - Border-radius mais refinado (6/8/10)
 *  - Tipografia Inter via system stack
 *  - Hover states em botões e inputs
 *  - Cores com matiz mais saturada (azul indigo, verde sage, ambar)
 */

export const colors = {
  // Backgrounds
  bg: '#f7f8fa',
  bgAlt: '#fafbfc',
  surface: '#ffffff',
  surfaceHover: '#f9fafb',

  // Borders
  border: '#e6e8ec',
  borderStrong: '#cdd1d8',
  borderFocus: '#6366f1',

  // Text
  text: '#0f172a',
  textSubtle: '#475569',
  muted: '#64748b',
  mutedLight: '#94a3b8',

  // Brand (indigo moderno em vez de azul básico)
  primary: '#6366f1',
  primaryHover: '#4f46e5',
  primaryLight: '#eef2ff',

  // Semânticas
  danger: '#e11d48',
  dangerHover: '#be123c',
  dangerLight: '#fff1f2',

  success: '#10b981',
  successHover: '#059669',
  successLight: '#ecfdf5',

  warning: '#f59e0b',
  warningHover: '#d97706',
  warningLight: '#fffbeb',

  info: '#0ea5e9',
  infoLight: '#f0f9ff',
};

/** Spacing scale — 4px base. Use múltiplos. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

/** Shadows em camadas — usar em vez de border quando dar elevação. */
export const shadows = {
  sm: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
  md: '0 1px 3px 0 rgba(15, 23, 42, 0.08), 0 1px 2px -1px rgba(15, 23, 42, 0.04)',
  lg: '0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 2px 4px -2px rgba(15, 23, 42, 0.04)',
  xl: '0 20px 40px -8px rgba(15, 23, 42, 0.15), 0 8px 16px -4px rgba(15, 23, 42, 0.08)',
};

/** Border radius scale. */
export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 10,
  full: 999,
};

/** Font stack — Inter no topo. Browser cai pro system se Inter não tiver instalada. */
const fontStack =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const card: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  padding: spacing.xl,
  boxShadow: shadows.sm,
};

export const cardElevated: CSSProperties = {
  ...card,
  boxShadow: shadows.md,
};

export const btn: CSSProperties = {
  background: colors.primary,
  color: '#fff',
  border: 'none',
  borderRadius: radius.md,
  padding: '0.5rem 1rem',
  fontWeight: 500,
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: fontStack,
  transition: 'background 0.15s ease, transform 0.05s ease',
  boxShadow: shadows.sm,
};

export const btnSecondary: CSSProperties = {
  ...btn,
  background: colors.surface,
  color: colors.text,
  border: `1px solid ${colors.borderStrong}`,
  boxShadow: 'none',
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
  boxShadow: 'none',
};

export const input: CSSProperties = {
  width: '100%',
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.md,
  padding: '0.5rem 0.75rem',
  fontSize: 14,
  fontFamily: fontStack,
  background: colors.surface,
  color: colors.text,
  boxSizing: 'border-box',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  outline: 'none',
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
  letterSpacing: 0.4,
};

export const pageWrap: CSSProperties = {
  padding: spacing.xxl,
  fontFamily: fontStack,
  background: colors.bg,
  minHeight: '100vh',
  color: colors.text,
};

export const headerBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: spacing.xl,
  gap: spacing.lg,
  flexWrap: 'wrap',
};

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  fontSize: 14,
};

export const th: CSSProperties = {
  textAlign: 'left',
  padding: '0.625rem 0.875rem',
  borderBottom: `1px solid ${colors.border}`,
  fontWeight: 600,
  color: colors.muted,
  fontSize: 11,
  textTransform: 'uppercase',
  background: colors.bgAlt,
  letterSpacing: 0.5,
};

export const td: CSSProperties = {
  padding: '0.75rem 0.875rem',
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: 'middle',
};

/**
 * Badge — chip arredondado com cor base.
 * Background fica 12% da cor (mais sutil que antes), texto sem uppercase pra leitura melhor.
 */
export const badge = (color = colors.muted): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 9px',
  borderRadius: radius.full,
  fontSize: 11,
  fontWeight: 600,
  background: color + '1F', // 12% opacidade
  color,
  letterSpacing: 0.2,
  lineHeight: 1.6,
});
