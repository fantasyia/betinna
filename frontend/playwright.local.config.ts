import { defineConfig, devices } from '@playwright/test';

/**
 * Config da VARREDURA LOCAL pré-beta (Fase 1+).
 * Separado do `playwright.config.ts` (que é o E2E de staging/CI), pra os dois
 * nunca se misturarem. Roda contra o app local: frontend 5174 + backend 4001.
 *
 *   npm run e2e          → tudo
 *   npm run e2e:smoke    → só Camada 1 (@smoke)
 *   npm run e2e:report   → abre o relatório HTML
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';

export default defineConfig({
  testDir: './e2e/specs',
  outputDir: './e2e/output/test-results',
  // Não para tudo no 1º erro — continua e reporta no fim.
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: './e2e/output/report', open: 'never' }],
    ['json', { outputFile: './e2e/output/results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
