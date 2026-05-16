/**
 * Fixtures comuns aos 10 testes E2E — Sprint 4 FIX 7.
 */
import { type Page, expect } from '@playwright/test';

export const API_URL =
  process.env.E2E_API_URL ??
  process.env.VITE_API_URL ??
  'http://localhost:3001';

export const TEST_USERS = {
  ADMIN: {
    email: process.env.E2E_TEST_EMAIL_ADMIN ?? process.env.E2E_TEST_EMAIL ?? 'admin@betinna.ai',
    password: process.env.E2E_TEST_PASSWORD ?? 'Betinna@2026',
  },
  DIRETOR: {
    email: process.env.E2E_TEST_EMAIL_DIRETOR ?? 'diretor@betinna.ai',
    password: process.env.E2E_TEST_PASSWORD ?? 'Betinna@2026',
  },
  GERENTE: {
    email: process.env.E2E_TEST_EMAIL_GERENTE ?? 'gerente@betinna.ai',
    password: process.env.E2E_TEST_PASSWORD ?? 'Betinna@2026',
  },
  REP: {
    email: process.env.E2E_TEST_EMAIL_REP ?? 'rep@betinna.ai',
    password: process.env.E2E_TEST_PASSWORD ?? 'Betinna@2026',
  },
};

/**
 * Login helper — autentica e espera dashboard.
 *
 * Antes do goto, injeta `window.__BETINNA_E2E__ = true` que faz o auth-store
 * expor `window.__authToken__` e `window.__empresaIdAtiva__` (apenas em testes).
 * Em produção o flag sempre é undefined → store não expõe (segurança).
 */
export async function login(
  page: Page,
  creds: { email: string; password: string },
): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __BETINNA_E2E__: boolean }).__BETINNA_E2E__ = true;
  });
  await page.goto('/login');
  await page.getByTestId('email').fill(creds.email);
  await page.getByTestId('password').fill(creds.password);
  await page.getByTestId('login-btn').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
}
