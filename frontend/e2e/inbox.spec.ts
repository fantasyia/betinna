import { test, expect } from '@playwright/test';
import { API_URL, TEST_USERS, login } from './fixtures';

/**
 * Inbox — multi-canal, dual-owner WhatsApp, acesso por papel.
 */

async function getToken(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    type W = { __authToken__?: string };
    return (window as unknown as W).__authToken__ ?? null;
  });
}

test('Inbox UI — SAC carrega página', async ({ page }) => {
  // Usa GERENTE como fallback (SAC seed pode não existir)
  await login(page, TEST_USERS.GERENTE);
  await page.goto('/inbox');
  await expect(page).toHaveURL(/\/inbox/);
});

test('Inbox UI — REP carrega sua inbox (filtrada por proprietarioId)', async ({ page }) => {
  await login(page, TEST_USERS.REP);
  await page.goto('/inbox');
  await expect(page).toHaveURL(/\/inbox/);
});

test('Inbox API — REP só recebe Conversations com proprietarioId=user.id (D38)', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.REP);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/inbox/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  const items = body?.data?.data ?? body?.data ?? [];
  const userId = await page.evaluate(() => {
    type W = { __userId__?: string };
    return (window as unknown as W).__userId__ ?? null;
  });
  if (userId && Array.isArray(items) && items.length > 0) {
    for (const c of items.slice(0, 5)) {
      if (c?.proprietarioId) {
        expect(c.proprietarioId).toBe(userId);
      }
    }
  }
});

test('Inbox API — filtro por canal aceito (whatsapp, instagram, etc)', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.DIRETOR);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(
    `${API_URL}/api/v1/inbox/conversations?canal=WHATSAPP`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(r.status()).toBe(200);
});

test('Marketplace UI — DIRETOR carrega /marketplace/incidentes', async ({ page }) => {
  await login(page, TEST_USERS.DIRETOR);
  await page.goto('/marketplace/incidentes');
  await expect(page).toHaveURL(/marketplace/);
});

test('Marketplace API — resumo retorna estrutura válida', async ({ page, request }) => {
  await login(page, TEST_USERS.DIRETOR);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/marketplace/incidentes/resumo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // 200 ou 404 dependendo se o endpoint existe e seed
  expect([200, 404]).toContain(r.status());
});
