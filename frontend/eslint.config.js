import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js', '*.config.ts'],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // Scripts Node soltos na raiz (ex: shot.mjs) — globals de Node
  {
    files: ['*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },

  // TypeScript + React files
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // TypeScript recommended rules (subset — no type-aware rules to keep lint fast)
      ...tsPlugin.configs['eslint-recommended'].overrides?.[0]?.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',

      // React hooks rules
      ...reactHooks.configs.recommended.rules,

      // React Refresh (Vite HMR) — desligado: só afeta hot reload em dev,
      // não impacta build de produção e estava derrubando CI sem benefício real.
      'react-refresh/only-export-components': 'off',

      // Turn off base rule in favour of TS version
      'no-unused-vars': 'off',
    },
  },
];
