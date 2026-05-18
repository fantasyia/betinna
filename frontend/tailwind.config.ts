import type { Config } from 'tailwindcss';

/**
 * Tailwind config — Betinna.ai design system v3 (paleta oficial).
 *
 * Tokens consumidos via CSS variables definidas em src/index.css.
 * Light theme com identidade roxa+ciano da marca Betinna.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Backgrounds
        bg: 'var(--bg)',
        'bg-alt': 'var(--bg-alt)',
        surface: {
          DEFAULT: 'var(--surface)',
          hover: 'var(--surface-hover)',
          elevated: 'var(--surface-elevated)',
        },

        // Borders
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
          focus: 'var(--border-focus)',
        },

        // Text
        text: 'var(--text)',
        'text-subtle': 'var(--text-subtle)',
        muted: {
          DEFAULT: 'var(--muted)',
          light: 'var(--muted-light)',
        },

        // Brand — Betinna
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          light: 'var(--primary-light)',
          contrast: 'var(--primary-contrast)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          hover: 'var(--secondary-hover)',
          light: 'var(--secondary-light)',
        },
        magenta: {
          DEFAULT: 'var(--magenta)',
          hover: 'var(--magenta-hover)',
          light: 'var(--magenta-light)',
        },
        blue: {
          DEFAULT: 'var(--blue)',
          light: 'var(--blue-light)',
        },
        navy: 'var(--navy)',

        // Semânticas
        danger: 'var(--danger)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        info: 'var(--info)',

        // Channels
        channel: {
          whatsapp: 'var(--channel-whatsapp)',
          instagram: 'var(--channel-instagram)',
          facebook: 'var(--channel-facebook)',
          email: 'var(--channel-email)',
          ml: 'var(--channel-ml)',
          shopee: 'var(--channel-shopee)',
          amazon: 'var(--channel-amazon)',
          tiktok: 'var(--channel-tiktok)',
        },
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        xs: ['11px', { lineHeight: '1.5' }],
        sm: ['12px', { lineHeight: '1.55' }],
        base: ['13px', { lineHeight: '1.6' }],
        md: ['14px', { lineHeight: '1.55' }],
        lg: ['15px', { lineHeight: '1.5' }],
        xl: ['17px', { lineHeight: '1.4' }],
        '2xl': ['20px', { lineHeight: '1.3' }],
        '3xl': ['24px', { lineHeight: '1.25' }],
        '4xl': ['30px', { lineHeight: '1.2' }],
      },
      borderRadius: {
        DEFAULT: 'var(--radius-md)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgba(49, 19, 124, 0.06)',
        md: '0 2px 6px -1px rgba(49, 19, 124, 0.08), 0 1px 3px -1px rgba(49, 19, 124, 0.05)',
        lg: '0 8px 24px -4px rgba(49, 19, 124, 0.12), 0 2px 6px -2px rgba(49, 19, 124, 0.06)',
        xl: '0 24px 48px -8px rgba(49, 19, 124, 0.18), 0 8px 16px -4px rgba(49, 19, 124, 0.1)',
        ring: '0 0 0 3px rgba(49, 19, 124, 0.15)',
        'ring-strong': '0 0 0 3px rgba(49, 19, 124, 0.35)',
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)',
      },
      animation: {
        'fade-in': 'fadeIn 180ms cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-up': 'slideUp 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.8s ease-in-out infinite',
        'spin-slow': 'spin 2s linear infinite',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.4, 0, 0.2, 1)',
        bounce: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
