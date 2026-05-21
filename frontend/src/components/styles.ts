import type { CSSProperties } from 'react';

/**
 * Design tokens — Betinna.ai design system (v3 — paleta oficial Betinna, 2026-05-18).
 *
 * Identidade visual seguindo o protótipo HTML original:
 *  - LIGHT theme com tons quentes (bg #F8F7F2 creme)
 *  - Roxo profundo #31137C como primária
 *  - Ciano #4AC9E3 como secundária (gradiente roxo→ciano é a assinatura)
 *  - Magenta #BB29BB pra acentos especiais
 *  - Tipografia: Cabin (UI) + Fira Sans (display/headings)
 *
 * Mantém a mesma API de tokens (`colors.bg`, `colors.surface`, etc.) — todas as
 * páginas existentes continuam funcionando, só trocam de paleta.
 */

export const colors = {
  // ─── Backgrounds (escala de elevação, LIGHT) ───────────────────
  /** Base do app — creme quente. */
  bg: '#F8F7F2',
  /** Variação sutil pra dividir seções. */
  bgAlt: '#fdfcf8',
  /** Card padrão (branco puro). */
  surface: '#ffffff',
  /** Hover de card/linha — bege bem sutil. */
  surfaceHover: '#f4f1e9',
  /** Card elevado (modal, popover). */
  surfaceElevated: '#ffffff',

  // ─── Borders ────────────────────────────────────────────────────
  /** Padrão — divisores e bordas de card (lilás bem clarinho). */
  border: '#e0dbed',
  /** Mais visível — inputs, botões secundários. */
  borderStrong: '#cdc3e0',
  /** Focus ring — usa roxo primário. */
  borderFocus: '#31137C',

  // ─── Text ───────────────────────────────────────────────────────
  /** Texto principal — near-black com sutil tom azulado. */
  text: '#101820',
  /** Texto secundário (descrições). */
  textSubtle: '#3a3550',
  /** Mudo (labels, captions). */
  muted: '#6b6580',
  /** Quase invisível (placeholders, hints). */
  mutedLight: '#9892a8',

  // ─── Brand (cores oficiais brandbook Betinna) ────────────────────
  /** Primária — navy oficial. */
  primary: '#201554',
  primaryHover: '#15093c',
  primaryLight: '#ecebf3',
  primaryContrast: '#ffffff',

  /** Secundária — ciano oficial. */
  secondary: '#2bcae5',
  secondaryHover: '#1ba8c0',
  secondaryLight: '#defaff',

  /** Acento — magenta oficial (rosa). */
  magenta: '#bd1fbf',
  magentaHover: '#a01aa1',
  magentaLight: '#fae6fa',

  /** Azul — accent terciário. */
  blue: '#5C88DA',
  blueLight: '#eaf0fb',

  /** Navy — alias da primary. */
  navy: '#201554',

  // ─── Semânticas ─────────────────────────────────────────────────
  danger: '#c43c3c',
  dangerHover: '#a92e2e',
  dangerLight: '#fce8e8',

  success: '#2d8f5e',
  successHover: '#1f7349',
  successLight: '#e8f5ec',

  warning: '#b07820',
  warningHover: '#946420',
  warningLight: '#faf0d8',

  info: '#5C88DA',
  infoHover: '#4773c0',
  infoLight: '#eaf0fb',

  // ─── Cores de canal (Inbox / Conversation) ──────────────────────
  channelWhatsapp: '#25d366',
  channelInstagram: '#e1306c',
  channelFacebook: '#1877f2',
  channelEmail: '#0891b2',
  channelML: '#fbbf24',
  channelShopee: '#ee4d2d',
  channelAmazon: '#ff9900',
  channelTiktok: '#ff0050',
};

/** Spacing scale — 4px base. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

/** Shadows — sutis pra light theme. */
export const shadows = {
  sm: '0 1px 2px 0 rgba(49, 19, 124, 0.06)',
  md: '0 2px 6px -1px rgba(49, 19, 124, 0.08), 0 1px 3px -1px rgba(49, 19, 124, 0.05)',
  lg: '0 8px 24px -4px rgba(49, 19, 124, 0.12), 0 2px 6px -2px rgba(49, 19, 124, 0.06)',
  xl: '0 24px 48px -8px rgba(49, 19, 124, 0.18), 0 8px 16px -4px rgba(49, 19, 124, 0.1)',
  /** Ring de foco — usado em inputs/botões com keyboard navigation. */
  focusRing: '0 0 0 3px rgba(49, 19, 124, 0.15)',
};

/** Border radius scale. */
export const radius = {
  sm: 4,
  md: 6,
  lg: 10, // Betinna usa 10px como padrão
  xl: 12,
  full: 999,
};

/** Type scale (font-size em px). */
export const fontSize = {
  xs: 12,
  sm: 13,
  base: 14,
  md: 15,
  lg: 16,
  xl: 18,
  '2xl': 22,
  '3xl': 26,
  '4xl': 32,
};

/** Motion / transitions. */
export const motion = {
  fast: '120ms cubic-bezier(0.4, 0, 0.2, 1)',
  base: '180ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow: '280ms cubic-bezier(0.16, 1, 0.3, 1)',
};

/** Font stacks — Cabin (UI) + Fira Sans (display). */
const fontStackUI =
  '"Cabin", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const fontStackDisplay =
  '"Fira Sans", "Cabin", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const fontStackMono = '"Fira Mono", "SF Mono", "Monaco", monospace';

export const fonts = {
  ui: fontStackUI,
  display: fontStackDisplay,
  mono: fontStackMono,
};

/** Gradiente assinatura: roxo → ciano. */
export const gradientBrand = `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`;

// ═══════════════════════════════════════════════════════════════
// LEGACY STYLE OBJECTS — mantidos pras 30 páginas existentes.
// ═══════════════════════════════════════════════════════════════

export const card: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  padding: spacing.xl,
};

export const cardElevated: CSSProperties = {
  ...card,
  background: colors.surfaceElevated,
  boxShadow: shadows.md,
};

export const btn: CSSProperties = {
  background: colors.primary,
  color: colors.primaryContrast,
  border: 'none',
  borderRadius: radius.md,
  padding: '0.5rem 1rem',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: fontStackUI,
  transition: `background ${motion.fast}, transform ${motion.fast}`,
  letterSpacing: -0.1,
};

export const btnSecondary: CSSProperties = {
  ...btn,
  background: colors.surface,
  color: colors.text,
  border: `1px solid ${colors.borderStrong}`,
  fontWeight: 500,
};

export const btnDanger: CSSProperties = {
  ...btn,
  background: colors.danger,
  color: '#fff',
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
  borderRadius: radius.md,
  padding: '0.5rem 0.75rem',
  fontSize: 13,
  fontFamily: fontStackUI,
  background: colors.surface,
  color: colors.text,
  boxSizing: 'border-box',
  transition: `border-color ${motion.fast}, box-shadow ${motion.fast}`,
  outline: 'none',
};

export const select: CSSProperties = {
  ...input,
  appearance: 'auto',
  colorScheme: 'light',
};

export const label: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  color: colors.muted,
  marginBottom: 6,
  letterSpacing: 0.6,
};

export const pageWrap: CSSProperties = {
  padding: spacing.xxl,
  fontFamily: fontStackUI,
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
  fontSize: 13,
};

export const th: CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  borderBottom: `1px solid ${colors.border}`,
  fontWeight: 600,
  color: colors.muted,
  fontSize: 11,
  textTransform: 'uppercase',
  background: colors.bgAlt,
  letterSpacing: 0.6,
};

export const td: CSSProperties = {
  padding: '12px 14px',
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: 'middle',
  color: colors.text,
};

/**
 * Badge — chip arredondado com cor base.
 * BG ~14% opacidade da cor + cor sólida no texto. Funciona bem em light.
 */
export const badge = (color = colors.muted): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 9px',
  borderRadius: radius.full,
  fontSize: 11,
  fontWeight: 600,
  background: color + '20',
  color,
  letterSpacing: 0.2,
  lineHeight: 1.6,
  border: `1px solid ${color}30`,
});

/** Tabular numbers — pra colunas de dinheiro/quantidade. */
export const tabular: CSSProperties = {
  fontFamily: fontStackMono,
  fontVariantNumeric: 'tabular-nums',
};
