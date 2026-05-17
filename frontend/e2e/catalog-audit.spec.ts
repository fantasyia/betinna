import { test, expect } from '@playwright/test';
import { API_URL, TEST_USERS, login } from './fixtures';

/**
 * E2E: Catalog share token (JWT TTL 7d) + Audit log viewer + Validators pt-BR.
 *
 * Cobertura dos endpoints criados na rodada de auditoria 2026-05-17.
 */

async function getToken(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    type W = { __authToken__?: string };
    return (window as unknown as W).__authToken__ ?? null;
  });
}

// ─── Catalog share token ─────────────────────────────────────────────

test('Catalog share — endpoint público rejeita token inválido', async ({ request }) => {
  const r = await request.get(`${API_URL}/api/v1/catalogo/share/not-a-valid-jwt`);
  expect([401, 400]).toContain(r.status());
});

test('Catalog share — endpoint público rejeita token expirado/malformado', async ({
  request,
}) => {
  // Token JWT malformado (3 partes mas conteúdo inválido)
  const r = await request.get(
    `${API_URL}/api/v1/catalogo/share/eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.fake`,
  );
  expect([401, 400]).toContain(r.status());
});

test('Catalog share — POST /share exige autenticação (REP+)', async ({ request }) => {
  const r = await request.post(`${API_URL}/api/v1/catalogo/share`, {
    data: { clienteId: 'fake', canal: 'WHATSAPP' },
  });
  expect([401, 403]).toContain(r.status());
});

// ─── Audit log viewer ────────────────────────────────────────────────

test('Audit — REP recebe 403 ao listar audit log (ADMIN only)', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.REP);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/audit`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([401, 403]).toContain(r.status());
});

test('Audit — DIRETOR recebe 403 (ADMIN only)', async ({ page, request }) => {
  await login(page, TEST_USERS.DIRETOR);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/audit`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([401, 403]).toContain(r.status());
});

test('Audit — ADMIN consegue listar com filtros + paginação', async ({ page, request }) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/audit?page=1&limit=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  expect(data).toHaveProperty('data');
  expect(data).toHaveProperty('pagination');
});

test('Audit — ADMIN consegue listar recursos únicos', async ({ page, request }) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/audit/recursos`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  expect(Array.isArray(data)).toBe(true);
});

test('Audit — limit max 100 enforced', async ({ page, request }) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  // Zod rejeita limit > 100
  const r = await request.get(`${API_URL}/api/v1/audit?limit=500`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([400, 422]).toContain(r.status());
});

test('Audit — filtros de período aceitos', async ({ page, request }) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(
    `${API_URL}/api/v1/audit?de=2026-01-01&ate=2026-12-31`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(r.status()).toBe(200);
});

test('Audit — GET /audit/:id inexistente retorna 404', async ({ page, request }) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/audit/audit-id-inexistente`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([404, 400]).toContain(r.status());
});
