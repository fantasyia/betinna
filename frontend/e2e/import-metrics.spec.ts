import { test, expect } from '@playwright/test';
import { API_URL, TEST_USERS, login } from './fixtures';

/**
 * Import CSV + Métricas Prometheus + Health expandido.
 */

async function getToken(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    type W = { __authToken__?: string };
    return (window as unknown as W).__authToken__ ?? null;
  });
}

// ─── Import ──────────────────────────────────────────────────────────

test('Import API — REP recebe 403 em /import/clientes', async ({ page, request }) => {
  await login(page, TEST_USERS.REP);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/import/clientes`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { csv: 'nome\nCli A', dryRun: true, onDuplicate: 'skip' },
  });
  expect([401, 403]).toContain(r.status());
});

test('Import API — dryRun=true não persiste mas reporta count', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.DIRETOR);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/import/clientes`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      csv: 'nome,cnpj\nCliente Teste E2E,11.222.333/0001-44',
      dryRun: true,
      onDuplicate: 'skip',
    },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  expect(data.dryRun).toBe(true);
  expect(data.total).toBe(1);
  expect(data.criados).toBe(1);
});

test('Import API — Zod rejeita csv vazio', async ({ page, request }) => {
  await login(page, TEST_USERS.DIRETOR);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/import/clientes`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { csv: '', dryRun: true, onDuplicate: 'skip' },
  });
  expect([400, 422]).toContain(r.status());
});

test('Import API — produtos é DIRECTOR/ADMIN only (GERENTE bloqueado)', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.GERENTE);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.post(`${API_URL}/api/v1/import/produtos`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { csv: 'nome,preco\nProd A,10', dryRun: true, onDuplicate: 'skip' },
  });
  expect([401, 403]).toContain(r.status());
});

// ─── Métricas ────────────────────────────────────────────────────────

test('Metrics — /metrics endpoint é público e expõe Prometheus format', async ({
  request,
}) => {
  const r = await request.get(`${API_URL}/api/v1/metrics`);
  expect(r.status()).toBe(200);
  const body = await r.text();
  // Formato Prometheus: linhas começando com # HELP / # TYPE + métricas
  expect(body).toContain('# HELP');
  expect(body).toContain('# TYPE');
  // Pelo menos uma das nossas métricas custom
  expect(body).toMatch(/betinna_\w+/);
});

test('Metrics — inclui default Node metrics (event loop, GC)', async ({ request }) => {
  const r = await request.get(`${API_URL}/api/v1/metrics`);
  const body = await r.text();
  expect(body).toContain('betinna_nodejs_eventloop_lag');
  expect(body).toContain('betinna_process_resident_memory_bytes');
});

// ─── Health expandido ────────────────────────────────────────────────

test('Health — /health é público e responde 200 com status=ok', async ({ request }) => {
  const r = await request.get(`${API_URL}/api/v1/health`);
  expect(r.status()).toBe(200);
  const body = await r.json();
  const data = body?.data ?? body;
  expect(data.status).toBe('ok');
});

test('Health — /health/deep exige ADMIN', async ({ page, request }) => {
  await login(page, TEST_USERS.REP);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/health/deep`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([401, 403]).toContain(r.status());
});

test('Health — ADMIN consegue ver /health/deep com todos os checks', async ({
  page,
  request,
}) => {
  await login(page, TEST_USERS.ADMIN);
  const token = await getToken(page);
  if (!token) {
    test.skip(true, 'token não exposto');
    return;
  }
  const r = await request.get(`${API_URL}/api/v1/health/deep`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Pode dar 200 (tudo ok) ou 503 (alguma dep degradada)
  expect([200, 503]).toContain(r.status());
  const body = await r.json();
  // Quando 503, o body é o payload de erro NestJS — busca em camadas
  const data =
    body?.data ?? body?.error?.details?.payload ?? body?.response ?? body;
  expect(data.checks).toBeDefined();
  expect(data.checks.database).toBeDefined();
  expect(data.checks.redis).toBeDefined();
  expect(data.checks.bullmq).toBeDefined();
  expect(data.checks.supabase).toBeDefined();
  expect(data.checks.integracoes).toBeDefined();
});
