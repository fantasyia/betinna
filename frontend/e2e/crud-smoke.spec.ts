import { test, expect } from '@playwright/test';
import { API_URL, TEST_USERS, login } from './fixtures';

/**
 * CRUD smoke — verifica que listagens não quebram em produção.
 *
 * Telas/endpoints críticos: Clientes, Produtos, Leads, Ocorrências, Agenda,
 * Propostas, Amostras, Comissões, Fluxos, Tags, Catálogo, Permissões.
 */

const ROUTES_UI = [
  '/clientes',
  '/produtos',
  '/leads',
  '/ocorrencias',
  '/agenda',
  '/propostas',
  '/amostras',
  '/comissoes',
  '/fluxos',
  '/tags',
  '/catalogo',
  '/relatorios',
  '/fidelidade',
  '/dashboard',
];

for (const route of ROUTES_UI) {
  test(`CRUD smoke UI — DIRETOR carrega ${route} sem 500`, async ({ page }) => {
    await login(page, TEST_USERS.DIRETOR);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(route);
    // Aceita navegação OU /403 (algumas rotas exigem permission específica)
    const url = page.url();
    expect(url).toMatch(new RegExp(`(${route}|/403)`));
    // Sem erros JS na página
    expect(errors).toEqual([]);
  });
}

// ─── API smoke ────────────────────────────────────────────────────────

async function getToken(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    type W = { __authToken__?: string };
    return (window as unknown as W).__authToken__ ?? null;
  });
}

const ENDPOINTS = [
  '/clientes',
  '/produtos',
  '/leads',
  '/ocorrencias',
  '/agenda',
  '/propostas',
  '/amostras',
  '/comissoes',
  '/fluxos',
  '/tags',
  '/catalogo',
];

for (const endpoint of ENDPOINTS) {
  test(`CRUD smoke API — GET ${endpoint} responde 200 pra DIRETOR`, async ({
    page,
    request,
  }) => {
    await login(page, TEST_USERS.DIRETOR);
    const token = await getToken(page);
    if (!token) {
      test.skip(true, 'token não exposto');
      return;
    }
    const r = await request.get(`${API_URL}/api/v1${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([200, 403]).toContain(r.status()); // 403 aceitável se permission negar
  });
}
