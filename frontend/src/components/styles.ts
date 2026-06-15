/**
 * Design tokens — Betinna.ai design system (v5 — TOKENS-ONLY, 2026-06-15).
 *
 * Este arquivo é hoje **só tokens JS** (`colors`, `alpha`, `radius`, `spacing`,
 * `shadows`, `fontSize`, `motion`, `fonts`, `gradientBrand`). Os objetos de estilo
 * legados (CSSProperties: card/btn/input/td/th/badge/etc.) foram **migrados pra
 * Tailwind e removidos** — a UI inteira usa classes Tailwind + CSS vars do `index.css`.
 * Mantenha aqui APENAS valores que o JS precisa em runtime (ex.: cor passada pra
 * um `<svg>`/chart). Pra estilo de elemento, use classes Tailwind, não daqui.
 *
 * **G1 (2026-05-21):** as cores referenciam as CSS variables do `index.css`, então
 * os tokens respeitam o dark mode automaticamente.
 *
 * Identidade visual:
 *  - LIGHT theme com bg creme #F8F7F2
 *  - Navy #201554 como primária (#bd1fbf magenta vira primária no dark)
 *  - Ciano #2bcae5 como secundária
 *  - Tipografia: Cabin (UI) + Fira Sans (display/headings)
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
