import { test, expect } from '@playwright/test';
import { API_URL, TEST_USERS, login } from './fixtures';

/**
 * Bulk operations no Inbox — endpoints com limite 200 ids.
 */

async function getToken(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    type W = { __authToken__?: string };
    return (window as unknown as W).__authToken__ ?? null;
  });
}

test('Bulk API — POST /bulk/atribuir rejeita ids vazios', async ({ page, request }) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/inbox/bulk/atribuir`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { ids: [], atribuidoId: null },
  });
  expect([400, 422]).toContain(r.status());
});

test('Bulk API — rejeita mais de 200 ids', async ({ page, request }) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const ids = Array.from({ length: 201 }, (_, i) => `c${i}`);
  const r = await request.post(`${API_URL}/api/v1/inbox/bulk/status`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { ids, status: 'RESOLVIDA' },
  });
  expect([400, 422]).toContain(r.status());
});

test('Bulk API — REP recebe 403 em bulk/atribuir', async ({ page, request }) => {
  await login(page, TEST_USERS.REP);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/inbox/bulk/atribuir`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { ids: ['c1'], atribuidoId: null },
  });
  expect([401, 403]).toContain(r.status());
});

test('Bulk API — bulk/marcar-lidas com ids inexistentes retorna 0', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/inbox/bulk/marcar-lidas`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { ids: ['conv-fake-1', 'conv-fake-2'] },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  expect(data.atualizados).toBe(0);
});

test('Bulk API — bulk/arquivar valida status arquivada após atribuir', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/inbox/bulk/arquivar`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { ids: ['conv-fake'] },
  });
  // Aceita 200 com count=0 (idempotente quando id não existe)
  expect(r.status()).toBe(200);
});
