import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — Sprint 4 FIX 7.
 *
 * E2E rodam contra ambiente real (staging Railway ou local dev).
 * Variáveis E2E_* configuradas no Railway service "E2E" ou GitHub Actions.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Tests de rate limit precisam serial
  forbidOnly: !!process.env.CI,
  // 1 retry sempre — testes E2E contra prod sofrem com rate limit acumulado
  // entre specs. Retry dá uma segunda chance após cool-down implícito.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
