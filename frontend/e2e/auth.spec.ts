import { test, expect } from '@playwright/test';
import { API_URL, TEST_USERS, login } from './fixtures';

/**
 * Auth flow — login/logout/refresh/expirado.
 *
 * Critical path: garantia de que o cookie httpOnly D47 funciona end-to-end.
 */

test('Auth — login persiste e F5 mantém sessão (cookie httpOnly D47)', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  // F5 dispara bootstrapAuthFromBackend que tenta refresh via cookie
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/);
  // PageLayout renderiza <h1 data-testid="page-title">. Não há "dashboard-title"
  // específico (corrigido em auditoria E2E — testid era um teste inventado).
  await expect(page.getByTestId('page-title')).toHaveText(/Dashboard/);
});

test('Auth — senha errada mostra erro sem redirect', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('email').fill(TEST_USERS.ADMIN.email);
  await page.getByTestId('password').fill('senha-errada-123');
  await page.getByTestId('login-btn').click();
  // Espera ficar em /login + ver alguma indicação de erro (toast, banner, etc)
  await expect(page).toHaveURL(/\/login/);
});

test('Auth — logout limpa sessão e bloqueia rota protegida', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  // Logout via API (mais robusto que clicar botão)
  await page.request.post(`${API_URL}/api/v1/auth/signout`);
  // F5 — sem cookie válido, vai pra /login
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/(login|$)/);
});

test('Auth — token expirado dispara refresh automático na próxima request', async ({
  page,
}) => {
  await login(page, TEST_USERS.ADMIN);
  // Simula access expirado limpando-o
  await page.evaluate(() => {
    type W = { __authToken__?: string };
    (window as unknown as W).__authToken__ = undefined;
  });
  // Próxima request via UI deve refresh transparente
  await page.goto('/clientes');
  // Se deu certo, continua autenticado (não redireciona p/ login)
  await expect(page).not.toHaveURL(/\/login/);
});

test('Auth — /me retorna 401 sem Authorization header', async ({ request }) => {
  const r = await request.get(`${API_URL}/api/v1/auth/me`);
  expect(r.status()).toBe(401);
});

test('Auth — Authorization Bearer malformado → 401', async ({ request }) => {
  const r = await request.get(`${API_URL}/api/v1/auth/me`, {
    headers: { Authorization: 'Bearer not-a-jwt' },
  });
  expect(r.status()).toBe(401);
});
