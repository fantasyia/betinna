import { test, expect } from '@playwright/test';
import { TEST_USERS, login } from './fixtures';

/**
 * Seed Demo (v1.2.0) — admin popula dataset de demonstração e depois limpa.
 *
 * Cenário crítico do onboarding comercial: ADMIN abre AdminPage, clica em
 * "Popular dataset demo", confirma, ve as contagens subirem; depois clica
 * "Limpar dados demo", confirma, contagens zeram. Dados reais não são
 * afetados (filtro isDemo=true).
 */

test('Seed Demo — admin vê seção 📦 Dados de demonstração na AdminPage', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/admin');
  // Busca pelo header da seção
  await expect(page.locator('text=Dados de demonstração').first()).toBeVisible({
    timeout: 10_000,
  });
  // Badge state visível (mostra "sem dataset" ou "X demo records")
  await expect(page.getByTestId('seed-demo-state')).toBeVisible();
});

test('Seed Demo — botão Popular dataset existe e tem cor magenta oficial', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/admin');
  const runBtn = page.getByTestId('seed-demo-run');
  await expect(runBtn).toBeVisible();
  const bg = await runBtn.evaluate((el) => window.getComputedStyle(el).backgroundColor);
  // #bd1fbf magenta brandbook = rgb(189, 31, 191)
  expect(bg).toBe('rgb(189, 31, 191)');
});

test('Seed Demo — popular + verificar contagens > 0 + limpar volta a zero', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/admin');

  // ─── Estado inicial: pode ter dataset ou não — limpa primeiro pra garantir baseline ─
  const wipeBtn = page.getByTestId('seed-demo-wipe');
  // Wipe só fica enabled quando há dados; se já está vazio, pula
  if (await wipeBtn.isEnabled().catch(() => false)) {
    await wipeBtn.click();
    // Confirmação destrutiva
    await page.getByRole('button', { name: /limpar dados demo/i }).click();
    // Espera badge voltar pra "sem dataset"
    await expect(page.getByTestId('seed-demo-state')).toContainText(/sem dataset/i, {
      timeout: 15_000,
    });
  }

  // ─── Popular ─────────────────────────────────────────────────────
  await page.getByTestId('seed-demo-run').click();
  // Confirmação de popular
  await page.getByRole('button', { name: /^popular$/i }).click();
  // Espera badge mostrar contagem (pode demorar ~10s pra criar 750+ records)
  await expect(page.getByTestId('seed-demo-state')).toContainText(/demo records/i, {
    timeout: 30_000,
  });

  // ─── Limpar ──────────────────────────────────────────────────────
  await page.getByTestId('seed-demo-wipe').click();
  await page.getByRole('button', { name: /limpar dados demo/i }).click();
  await expect(page.getByTestId('seed-demo-state')).toContainText(/sem dataset/i, {
    timeout: 15_000,
  });
});

test('Seed Demo — REP não vê a seção (apenas ADMIN/DIRECTOR backend, mas frontend hide opcional)', async ({
  page,
}) => {
  // REP não tem acesso à rota /admin (RBAC gate na route);
  // espera redirect ou erro de permissão
  await login(page, TEST_USERS.REP);
  await page.goto('/admin');
  // Aceita 2 outcomes: redirect pra dashboard OU mensagem de "sem permissão"
  await page.waitForTimeout(1500);
  const url = page.url();
  const visible = await page.locator('text=Dados de demonstração').isVisible().catch(() => false);
  // OR — qualquer um basta
  expect(visible === false || !url.includes('/admin')).toBe(true);
});
