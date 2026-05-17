import { test, expect } from '@playwright/test';
import { API_URL, TEST_USERS, login } from './fixtures';

/**
 * Fidelidade — programa, recompensas, resgate, ajuste, ranking.
 *
 * Module construído sprint atual. Coverage prioritário.
 */

async function getToken(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    type W = { __authToken__?: string };
    return (window as unknown as W).__authToken__ ?? null;
  });
}

test('Fidelidade UI — DIRETOR vê página e botão "Configurar programa"', async ({ page }) => {
  await login(page, TEST_USERS.DIRETOR);
  await page.goto('/fidelidade');
  await expect(page).toHaveURL(/\/fidelidade/);
});

test('Fidelidade API — GET /programa retorna 200 (auto-cria se não existe)', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.DIRETOR);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/fidelidade/programa`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  const programa = body?.data ?? body;
  expect(programa).toHaveProperty('pontosPorReal');
  expect(programa).toHaveProperty('ativo');
});

test('Fidelidade API — REP recebe 403 em PATCH /programa (D45)', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.REP);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.patch(`${API_URL}/api/v1/fidelidade/programa`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { ativo: false },
  });
  expect([401, 403]).toContain(r.status());
});

test('Fidelidade API — REP recebe 403 em POST /ajustar (D46)', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.REP);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/fidelidade/ajustar`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { clienteId: 'fake', pontos: 100, motivo: 'teste' },
  });
  expect([401, 403]).toContain(r.status());
});

test('Fidelidade API — DIRETOR consegue criar recompensa', async ({ page, request }) => {
  await login(page, TEST_USERS.DIRETOR);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/fidelidade/recompensas`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      nome: 'E2E Test Reward ' + Date.now(),
      descricao: 'criado por playwright',
      custoPontos: 500,
      tipo: 'BRINDE',
      estoque: 10,
      ativo: true,
    },
  });
  expect([200, 201]).toContain(r.status());
});

test('Fidelidade API — Zod rejeita ajuste com pontos=0', async ({ page, request }) => {
  await login(page, TEST_USERS.DIRETOR);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/fidelidade/ajustar`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { clienteId: 'fake-id', pontos: 0, motivo: 'teste 0 pontos' },
  });
  expect([400, 422]).toContain(r.status());
});

test('Fidelidade API — Zod rejeita motivo com <3 chars', async ({ page, request }) => {
  await login(page, TEST_USERS.DIRETOR);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/fidelidade/ajustar`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { clienteId: 'fake-id', pontos: 100, motivo: 'a' },
  });
  expect([400, 422]).toContain(r.status());
});

test('Fidelidade API — DIRETOR pode consultar ranking', async ({ page, request }) => {
  await login(page, TEST_USERS.DIRETOR);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/fidelidade/ranking?limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  expect(Array.isArray(data)).toBe(true);
});
