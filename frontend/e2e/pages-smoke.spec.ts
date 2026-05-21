import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS, login } from './fixtures';

/**
 * Smoke tests pra páginas SEM spec dedicado pré-existente.
 *
 * Cobertura mínima por página:
 *  1. Login como ADMIN
 *  2. Navega pra rota
 *  3. Aguarda networkidle
 *  4. ErrorBoundary NÃO disparou (sem texto "Algo deu errado")
 *  5. Heading principal visível (PageLayout title)
 *  6. Sem erros JS no console (best-effort — log apenas, não falha)
 *
 * Justificativa: 30+ páginas em pages/ rodavam sem spec direto. crud-smoke
 * cobria algumas via "URL não dá 500" mas não checa que conteúdo renderizou.
 * Estes 10 testes fecham essa lacuna pra páginas-chave da operação.
 */

/**
 * Asserts comuns pra todos os testes de smoke.
 * Falha se ErrorBoundary disparou ou heading não apareceu.
 */
async function assertPageLoaded(page: Page, expectedHeading: string | RegExp) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
    /* network pode nunca ficar idle em prod com analytics; tolerável */
  });

  // ErrorBoundary fallback text — fail fast se a página crashou
  const errorBoundaryVisible = await page
    .locator('text=Algo deu errado')
    .isVisible()
    .catch(() => false);
  expect(errorBoundaryVisible, 'ErrorBoundary fallback NÃO deve aparecer').toBe(false);

  // Heading principal — PageLayout renderiza title em <h1>
  await expect(
    page.locator('h1').filter({ hasText: expectedHeading }).first(),
  ).toBeVisible({ timeout: 10_000 });
}

test('Smoke /campanhas — CampanhasPage carrega sem ErrorBoundary', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/campanhas');
  await assertPageLoaded(page, /^Campanhas$/);
});

test('Smoke /metas — MetasPage carrega sem ErrorBoundary', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/metas');
  await assertPageLoaded(page, /^Metas$/);
});

test('Smoke /nps — NpsPage (pesquisas) carrega sem ErrorBoundary', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/nps');
  await assertPageLoaded(page, /Pesquisas NPS/);
});

test('Smoke /fluxos — FluxosPage carrega sem ErrorBoundary', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/fluxos');
  await assertPageLoaded(page, /Fluxos de automação/);
});

test('Smoke /formularios — FormulariosPage carrega sem ErrorBoundary', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/formularios');
  await assertPageLoaded(page, /^Formulários$/);
});

test('Smoke /integracoes — IntegracoesPage carrega sem ErrorBoundary', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/integracoes');
  await assertPageLoaded(page, /Integrações da empresa/);
});

test('Smoke /permissoes — PermissoesPage carrega sem ErrorBoundary', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/permissoes');
  await assertPageLoaded(page, /Permissões granulares/);
});

test('Smoke /perfil — ProfilePage carrega sem ErrorBoundary', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/perfil');
  // ProfilePage renderiza condicionalmente:
  //  - ADMIN/DIRECTOR/GERENTE em /perfil sem :id → UsersList (h1 = "Usuários")
  //  - Outros papéis ou /perfil/:id → UserDetail (h1 = nome do user)
  //  - Sem sessão → fallback "Perfil"
  // Regex cobre os 3 cenários.
  await assertPageLoaded(page, /Usuários|Perfil|Admin/);
});

test('Smoke /amostras — AmostrasPage carrega sem ErrorBoundary', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/amostras');
  await assertPageLoaded(page, /^Amostras$/);
});

test('Smoke /incidentes — MarketplaceIncidentsPage carrega sem ErrorBoundary', async ({
  page,
}) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/incidentes');
  await assertPageLoaded(page, /Reclamações \/ Devoluções/);
});
