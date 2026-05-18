import type { CSSProperties } from 'react';

/**
 * Design tokens — Betinna.ai design system (v2 dark, 2026-05-18).
 *
 * Identidade visual: dark sofisticado inspirado em Linear/Vercel.
 *  - Paleta neutra com matiz frio (azul-cinza quase imperceptível)
 *  - Acento âmbar #facc15 (igual protótipo) — usado com parcimônia
 *  - Bordas sutis 1px, sem shadow agressiva
 *  - Tipografia: Inter (UI) + JetBrains Mono (tabular/code)
 *  - Motion: 150ms ease-out padrão
 *
 * Mantém a API original (colors, btn, card, badge, etc.) — todas as páginas
 * existentes continuam funcionando, só ficam dark. Primitives novos em
 * `components/ui/` usam essas mesmas variáveis via Tailwind/CSS vars.
 */

export const colors = {
  // ─── Backgrounds (escala de elevação) ─────────────────────────
  /** Base do app — onde nada flutua. */
  bg: '#0a0a0a',
  /** Variação sutil pra dividir seções (tabela header, sidebar footer). */
  bgAlt: '#0f0f10',
  /** Card padrão (1 nível acima do bg). */
  surface: '#141416',
  /** Hover de card/linha. */
  surfaceHover: '#1a1a1d',
  /** Card elevado (modal, popover, dropdown). */
  surfaceElevated: '#1c1c20',

  // ─── Borders ──────────────────────────────────────────────────
  /** Padrão — divisores e bordas de card. */
  border: '#262629',
  /** Mais visível — inputs, botões secundários. */
  borderStrong: '#33333a',
  /** Focus ring. */
  borderFocus: '#facc15',

  // ─── Text ─────────────────────────────────────────────────────
  /** Texto principal — quase branco. */
  text: '#fafafa',
  /** Texto secundário (descrições). */
  textSubtle: '#a1a1aa',
  /** Mudo (labels, captions). */
  muted: '#71717a',
  /** Quase invisível (placeholders, hints). */
  mutedLight: '#52525b',

  // ─── Brand (âmbar igual protótipo HTML) ───────────────────────
  primary: '#facc15',
  primaryHover: '#eab308',
  primaryLight: '#422006',         // bg sutil pra estado ativo (15% âmbar em preto)
  primaryContrast: '#0a0a0a',      // texto sobre primary

  // ─── Semânticas ───────────────────────────────────────────────
  danger: '#f43f5e',
  dangerHover: '#e11d48',
  dangerLight: '#3f1015',

  success: '#22c55e',
  successHover: '#16a34a',
  successLight: '#0f2818',

  warning: '#f59e0b',
  warningHover: '#d97706',
  warningLight: '#3a230a',

  info: '#38bdf8',
  infoHover: '#0ea5e9',
  infoLight: '#0c2230',

  // ─── Cores de canal (Inbox / Conversation) ────────────────────
  channelWhatsapp: '#22c55e',
  channelInstagram: '#e1306c',
  channelFacebook: '#1877f2',
  channelEmail: '#0891b2',
  channelML: '#facc15',
  channelShopee: '#ee4d2d',
  channelAmazon: '#ff9900',
  channelTiktok: '#ec4899',
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

/** Shadows — quase imperceptíveis no dark, dão profundidade sem ruído. */
export const shadows = {
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
  md: '0 2px 6px -1px rgba(0, 0, 0, 0.4), 0 1px 3px -1px rgba(0, 0, 0, 0.3)',
  lg: '0 8px 24px -4px rgba(0, 0, 0, 0.5), 0 2px 6px -2px rgba(0, 0, 0, 0.3)',
  xl: '0 24px 48px -8px rgba(0, 0, 0, 0.6), 0 8px 16px -4px rgba(0, 0, 0, 0.4)',
  /** Ring de foco — usado em inputs/botões com keyboard navigation. */
  focusRing: '0 0 0 3px rgba(250, 204, 21, 0.15)',
};

/** Border radius scale. */
export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 999,
};

/** Type scale (font-size em px). */
export const fontSize = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 15,
  xl: 17,
  '2xl': 20,
  '3xl': 24,
  '4xl': 30,
};

/** Motion / transitions. */
export const motion = {
  /** Padrão pra hover, color, bg. */
  fast: '120ms cubic-bezier(0.4, 0, 0.2, 1)',
  /** Padrão pra layout shift, slide. */
  base: '180ms cubic-bezier(0.4, 0, 0.2, 1)',
  /** Pra modal/drawer entrando. */
  slow: '280ms cubic-bezier(0.16, 1, 0.3, 1)',
};

/** Font stacks. */
const fontStackUI =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const fontStackMono =
  '"JetBrains Mono", "SF Mono", "Monaco", "Cascadia Code", "Roboto Mono", monospace';

export const fonts = {
  ui: fontStackUI,
  mono: fontStackMono,
};

// ═══════════════════════════════════════════════════════════════
// LEGACY STYLE OBJECTS — mantidos pras 30 páginas existentes.
// Novos componentes devem usar primitives em `components/ui/*`.
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
  background: colors.bg,
  color: colors.text,
  boxSizing: 'border-box',
  transition: `border-color ${motion.fast}, box-shadow ${motion.fast}`,
  outline: 'none',
};

export const select: CSSProperties = {
  ...input,
  appearance: 'auto',
  /* Garante setinha legível em dark */
  colorScheme: 'dark',
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
 * BG 12% opacidade da cor + cor sólida no texto. Funciona bem em dark.
 */
export const badge = (color = colors.muted): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 9px',
  borderRadius: radius.full,
  fontSize: 11,
  fontWeight: 600,
  background: color + '24', // ~14% opacidade
  color,
  letterSpacing: 0.2,
  lineHeight: 1.6,
  border: `1px solid ${color}1F`,
});

/** Tabular numbers — pra colunas de dinheiro/quantidade. */
export const tabular: CSSProperties = {
  fontFamily: fontStackMono,
  fontVariantNumeric: 'tabular-nums',
};
