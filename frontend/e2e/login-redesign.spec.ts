import { test, expect } from '@playwright/test';
import { TEST_USERS } from './fixtures';

/**
 * Login redesign (v1.1.1) — valida que a LoginPage segue o BRANDBOOK.md
 * oficial: navy #201554, cyan #2bcae5, magenta #bd1fbf, Fira Sans Black
 * no título, border radius 10px nos inputs.
 *
 * Estes testes pegam regressão visual em PRs (alguém troca cor sem querer).
 */

test('Login redesign — gradient navy escuro de fundo + glow magenta sutil', async ({ page }) => {
  await page.goto('/login');
  // Container principal tem o radial-gradient navy
  const root = page.locator('form[data-testid="login-form"]').locator('..');
  await expect(root).toBeVisible();

  // Background do form card tem rgba(32, 21, 84) — navy oficial
  const formBg = await page
    .locator('form[data-testid="login-form"]')
    .evaluate((el) => window.getComputedStyle(el).background);
  // Aceita match parcial (background é composto: rgba + blur + image)
  expect(formBg).toContain('rgba(32, 21, 84');
});

test('Login redesign — botão CTA é magenta oficial (#bd1fbf)', async ({ page }) => {
  await page.goto('/login');
  const button = page.getByTestId('login-btn');
  await expect(button).toBeVisible();
  const bg = await button.evaluate((el) => window.getComputedStyle(el).backgroundColor);
  // #bd1fbf = rgb(189, 31, 191)
  expect(bg).toBe('rgb(189, 31, 191)');
});

test('Login redesign — input focus mostra ring ciano (#2bcae5)', async ({ page }) => {
  await page.goto('/login');
  const emailInput = page.getByTestId('email');
  await emailInput.focus();
  // CSS escopado aplica border-color: #2bcae5 no :focus
  await expect(emailInput).toBeFocused();
  // Aguarda estilo CSS aplicado (pode ter delay de transition)
  await page.waitForTimeout(200);
  const border = await emailInput.evaluate((el) => window.getComputedStyle(el).borderColor);
  // #2bcae5 = rgb(43, 202, 229)
  expect(border).toBe('rgb(43, 202, 229)');
});

test('Login redesign — título usa fonte Fira Sans (display) com peso 900', async ({ page }) => {
  await page.goto('/login');
  const titulo = page.getByText('Bem-vindo de volta');
  await expect(titulo).toBeVisible();
  const ff = await titulo.evaluate((el) => window.getComputedStyle(el).fontFamily);
  expect(ff.toLowerCase()).toContain('fira sans');
  const weight = await titulo.evaluate((el) => window.getComputedStyle(el).fontWeight);
  expect(weight).toBe('900');
});

test('Login redesign — logo horizontal SVG é exibido no topo', async ({ page }) => {
  await page.goto('/login');
  const logo = page.locator('img[alt="Betinna.ai"][src="/betinna-horizontal.svg"]');
  await expect(logo).toBeVisible();
});

test('Login redesign — fluxo completo de login ainda funciona após redesign', async ({ page }) => {
  // Garante que o redesign não quebrou a integração D47 (cookie httpOnly)
  await page.goto('/login');
  await page.getByTestId('email').fill(TEST_USERS.ADMIN.email);
  await page.getByTestId('password').fill(TEST_USERS.ADMIN.password);
  await page.getByTestId('login-btn').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
});
