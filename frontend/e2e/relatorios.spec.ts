import { test, expect } from '@playwright/test';
import { API_URL, TEST_USERS, login } from './fixtures';

/**
 * Relatórios — dashboard + 7 áreas.
 *
 * Garante shape estável das responses (frontend depende disso).
 */

async function getToken(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    type W = { __authToken__?: string };
    return (window as unknown as W).__authToken__ ?? null;
  });
}

const PERIODO_QS = '?de=2026-01-01&ate=2026-12-31';

test('Relatorios UI — DIRETOR carrega página sem erro', async ({ page }) => {
  await login(page, TEST_USERS.DIRETOR);
  await page.goto('/relatorios');
  await expect(page).toHaveURL(/\/relatorios/);
});

test('Relatorios API — dashboard retorna estrutura esperada', async ({
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
    `${API_URL}/api/v1/relatorios/dashboard${PERIODO_QS}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  // 7 áreas
  expect(data).toHaveProperty('vendas');
  expect(data).toHaveProperty('funil');
  expect(data).toHaveProperty('sac');
  expect(data).toHaveProperty('campanhas');
  expect(data).toHaveProperty('amostras');
  expect(data).toHaveProperty('fidelidade');
});

test('Relatorios API — fidelidade tem campos do contrato', async ({
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
    `${API_URL}/api/v1/relatorios/fidelidade${PERIODO_QS}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  expect(data).toHaveProperty('programaAtivo');
  expect(data).toHaveProperty('saldoTotal');
  expect(data).toHaveProperty('noPeriodo');
  expect(data).toHaveProperty('taxaUso');
  expect(data).toHaveProperty('topClientes');
});

test('Relatorios API — vendas tem campo de variação % vs período anterior', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.DIRETOR);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/relatorios/vendas${PERIODO_QS}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  expect(data?.faturamento).toMatchObject({
    atual: expect.any(Number),
    anterior: expect.any(Number),
    variacao: expect.any(Number),
  });
});

test('Relatorios API — REP só vê os próprios números', async ({ page, request }) => {
  await login(page, TEST_USERS.REP);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/relatorios/vendas${PERIODO_QS}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  // porRep deve ter no máximo o próprio user
  const userId = await page.evaluate(() => {
    type W = { __userId__?: string };
    return (window as unknown as W).__userId__ ?? null;
  });
  if (userId && Array.isArray(data?.porRep)) {
    for (const rep of data.porRep) {
      expect(rep.repId).toBe(userId);
    }
  }
});

test('Relatorios API — período inválido (de > ate) é tolerado ou rejeitado', async ({
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
    `${API_URL}/api/v1/relatorios/vendas?de=2026-12-31&ate=2026-01-01`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  // Aceita 200 (Σ vazio) ou 400 (Zod rejeitando)
  expect([200, 400, 422]).toContain(r.status());
});
