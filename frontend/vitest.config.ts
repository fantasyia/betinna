import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Config de testes UNITÁRIOS (vitest). Separado do vite.config pra não arrastar
 * PWA/manualChunks pro test runner. E2E (Playwright) é à parte (test:e2e).
 *
 * Ambiente jsdom por padrão — cobre tanto função pura (formatMoeda) quanto
 * código que toca window/localStorage (auth-store, lib/api).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    clearMocks: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
