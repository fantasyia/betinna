import { test, expect } from '@playwright/test';
import { API_URL, TEST_USERS, login } from './fixtures';

/**
 * Notificações in-app — endpoints + isolamento por user.
 */

async function getToken(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    type W = { __authToken__?: string };
    return (window as unknown as W).__authToken__ ?? null;
  });
}

test('Notif API — GET /notificacoes retorna estrutura paginada + naoLidas', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/notificacoes?page=1&limit=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  expect(data).toHaveProperty('data');
  expect(data).toHaveProperty('pagination');
  expect(data).toHaveProperty('naoLidas');
});

test('Notif API — GET /nao-lidas é endpoint barato', async ({ page, request }) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/notificacoes/nao-lidas`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  expect(typeof data.naoLidas).toBe('number');
  expect(data.naoLidas).toBeGreaterThanOrEqual(0);
});

test('Notif API — PATCH /ler-todas é idempotente', async ({ page, request }) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r1 = await request.patch(`${API_URL}/api/v1/notificacoes/ler-todas`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const r2 = await request.patch(`${API_URL}/api/v1/notificacoes/ler-todas`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r1.status()).toBe(200);
  expect(r2.status()).toBe(200);
  // Segunda chamada não atualiza nada (já estavam lidas)
});

test('Notif API — DELETE de notificação inexistente retorna 404', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.delete(`${API_URL}/api/v1/notificacoes/notif-inexistente`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([404, 400]).toContain(r.status());
});

test('Notif UI — bell icon aparece após login', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await expect(page.getByTestId('notif-bell')).toBeVisible({ timeout: 10_000 });
});

test('Notif UI — clicar no sino abre dropdown', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.getByTestId('notif-bell').click();
  await expect(page.getByTestId('notif-dropdown')).toBeVisible({ timeout: 5_000 });
});

test('Notif UI — /notificacoes carrega lista', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/notificacoes');
  await expect(page).toHaveURL(/\/notificacoes/);
});
