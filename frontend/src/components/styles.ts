import type { CSSProperties } from 'react';

/**
 * Design tokens — Betinna.ai design system (v4 — CSS vars + dark mode, 2026-05-21).
 *
 * **G1 fix (2026-05-21):** as cores agora referenciam as CSS variables definidas
 * em `index.css`. Isso faz com que os estilos legacy (objetos CSSProperties
 * abaixo) **respeitem o dark mode automaticamente** — antes eram hex fixos.
 *
 * Identidade visual:
 *  - LIGHT theme com bg creme #F8F7F2
 *  - Navy #201554 como primária (#bd1fbf magenta vira primária no dark)
 *  - Ciano #2bcae5 como secundária
 *  - Tipografia: Cabin (UI) + Fira Sans (display/headings)
 *
 * Mantém a mesma API de tokens (`colors.bg`, `colors.surface`, etc.) — todas as
 * páginas existentes continuam funcionando, mas agora trocam de paleta com o tema.
 */

export const colors = {
  // ─── Backgrounds (CSS vars — trocam no dark mode) ─────────────────
  /** Base do app — creme quente no light, navy no dark. */
  bg: 'var(--bg)',
  /** Variação sutil pra dividir seções. */
  bgAlt: 'var(--bg-alt)',
  /** Card padrão (branco no light, navy-elevated no dark). */
  surface: 'var(--surface)',
  /** Hover de card/linha. */
  surfaceHover: 'var(--surface-hover)',
  /** Card elevado (modal, popover). */
  surfaceElevated: 'var(--surface-elevated)',

  // ─── Borders ────────────────────────────────────────────────────
  /** Padrão — divisores e bordas de card. */
  border: 'var(--border)',
  /** Mais visível — inputs, botões secundários. */
  borderStrong: 'var(--border-strong)',
  /** Focus ring — primary no light, magenta no dark. */
  borderFocus: 'var(--border-focus)',

  // ─── Text ───────────────────────────────────────────────────────
  /** Texto principal. */
  text: 'var(--text)',
  /** Texto secundário (descrições). */
  textSubtle: 'var(--text-subtle)',
  /** Mudo (labels, captions). */
  muted: 'var(--muted)',
  /** Quase invisível (placeholders, hints). */
  mutedLight: 'var(--muted-light)',

  // ─── Brand (CSS vars trocam no dark mode) ────────────────────────
  /** Primária — navy no light, magenta no dark. */
  primary: 'var(--primary)',
  primaryHover: 'var(--primary-hover)',
  primaryLight: 'var(--primary-light)',
  primaryContrast: 'var(--primary-contrast)',

  /** Secundária — ciano. */
  secondary: 'var(--secondary)',
  secondaryHover: 'var(--secondary-hover)',
  secondaryLight: 'var(--secondary-light)',

  /** Acento — magenta. */
  magenta: 'var(--magenta)',
  magentaHover: 'var(--magenta-hover)',
  magentaLight: 'var(--magenta-light)',

  /** Azul — accent terciário. */
  blue: 'var(--blue)',
  blueLight: 'var(--blue-light)',

  /** Navy — fixo (não troca no dark). */
  navy: 'var(--navy)',

  // ─── Semânticas (CSS vars — tons brilham no dark) ────────────────
  danger: 'var(--danger)',
  dangerHover: '#a92e2e',
  dangerLight: '#fce8e8',

  success: 'var(--success)',
  successHover: '#1f7349',
  successLight: '#e8f5ec',

  warning: 'var(--warning)',
  warningHover: '#946420',
  warningLight: '#faf0d8',

  info: 'var(--info)',
  infoHover: '#4773c0',
  infoLight: '#eaf0fb',

  // ─── Cores de canal (fixas — não trocam no dark) ─────────────────
  channelWhatsapp: '#25d366',
  channelInstagram: '#e1306c',
  channelFacebook: '#1877f2',
  channelEmail: '#0891b2',
  channelML: '#fbbf24',
  channelShopee: '#ee4d2d',
  channelAmazon: '#ff9900',
  channelTiktok: '#ff0050',
};

/**
 * Aplica opacidade a uma cor (suporta hex E `var(--token)`).
 *
 * Antes do G1, o app usava concatenação hex+alpha tipo `colors.primary + '18'`.
 * Isso parou de funcionar quando `colors.primary` virou `var(--primary)` —
 * `var(--primary)18` não é CSS válido. Este helper usa `color-mix()`, que
 * funciona pra ambos.
 *
 * `color-mix()` é suportado em Chrome 111+, Firefox 113+, Safari 16.4+
 * (o app já depende disso em index.css).
 *
 * @param color cor base — pode ser hex (`#201554`) ou CSS var (`var(--primary)`)
 * @param pct percentual de opacidade 0–100 (ex: `alpha(colors.primary, 12)`)
 */
export function alpha(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

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
 * BG ~12% opacidade da cor + cor sólida no texto. Usa color-mix() pra
 * funcionar tanto com hex quanto com CSS vars (var(--magenta) etc.).
 */
export const badge = (color = colors.muted): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 9px',
  borderRadius: radius.full,
  fontSize: 11,
  fontWeight: 600,
  background: alpha(color, 12),
  color,
  letterSpacing: 0.2,
  lineHeight: 1.6,
  border: `1px solid ${alpha(color, 19)}`,
});

/** Tabular numbers — pra colunas de dinheiro/quantidade. */
export const tabular: CSSProperties = {
  fontFamily: fontStackMono,
  fontVariantNumeric: 'tabular-nums',
};
