import { test, expect } from '@playwright/test';
import { TEST_USERS, login } from './fixtures';

/**
 * Onboarding tour — flag em localStorage, restart, progress.
 *
 * Module construído sprint atual.
 */

test('Onboarding — aparece no 1º login (sem flag em localStorage)', async ({ page }) => {
  // Limpa localStorage antes de logar
  await page.goto('/login');
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  await login(page, TEST_USERS.REP);
  // Tour deve estar visível
  await expect(page.getByTestId('onboarding-tour')).toBeVisible({ timeout: 5_000 });
});

test('Onboarding — botão Pular fecha e persiste flag', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  await login(page, TEST_USERS.REP);
  await expect(page.getByTestId('onboarding-tour')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('onboarding-skip').click();
  await expect(page.getByTestId('onboarding-tour')).toHaveCount(0);
  // Flag deve estar setada
  const flag = await page.evaluate(() => {
    try {
      const keys = Object.keys(localStorage);
      return keys.find((k) => k.startsWith('onboarding:done:'));
    } catch {
      return null;
    }
  });
  expect(flag).toBeTruthy();
});

test('Onboarding — Próximo avança step e Concluir fecha no último', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  await login(page, TEST_USERS.DIRETOR);
  await expect(page.getByTestId('onboarding-tour')).toBeVisible({ timeout: 5_000 });
  // DIRECTOR tem 6 steps — clica Próximo 5 vezes, depois Concluir
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('onboarding-next').click();
  }
  // No último step o botão fica "Concluir"
  await expect(page.getByTestId('onboarding-next')).toHaveText(/concluir/i);
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-tour')).toHaveCount(0);
});

test('Onboarding — após concluído, F5 não reabre', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  await login(page, TEST_USERS.REP);
  await expect(page.getByTestId('onboarding-tour')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('onboarding-skip').click();
  await page.reload();
  await expect(page.getByTestId('onboarding-tour')).toHaveCount(0);
});
