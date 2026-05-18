import type { Config } from 'tailwindcss';

/**
 * Tailwind config — Betinna.ai design system v2.
 *
 * Tokens consumidos via CSS variables definidas em src/index.css.
 * Isso permite que primitives Tailwind e inline styles (styles.ts) compartilhem
 * a mesma fonte de verdade, evitando drift.
 *
 * Uso primário: primitives em src/components/ui/* via cva (class-variance-authority).
 * Pages legadas continuam usando inline styles importando de @/components/styles.
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

        // Brand
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          light: 'var(--primary-light)',
          contrast: 'var(--primary-contrast)',
        },

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
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        // Sobrescreve defaults pra ficar consistente com type scale do styles.ts
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
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
        md: '0 2px 6px -1px rgba(0, 0, 0, 0.4), 0 1px 3px -1px rgba(0, 0, 0, 0.3)',
        lg: '0 8px 24px -4px rgba(0, 0, 0, 0.5), 0 2px 6px -2px rgba(0, 0, 0, 0.3)',
        xl: '0 24px 48px -8px rgba(0, 0, 0, 0.6), 0 8px 16px -4px rgba(0, 0, 0, 0.4)',
        ring: '0 0 0 3px rgba(250, 204, 21, 0.15)',
        'ring-strong': '0 0 0 3px rgba(250, 204, 21, 0.4)',
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
