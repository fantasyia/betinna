import { test, expect } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Smoke da Fase 1 — prova que a cadeia inteira está de pé:
 * Playwright → frontend (5174) → backend (4001) → Supabase local → banco semeado.
 * (Os roteiros completos por área entram na Fase 2.)
 */
test.describe('Smoke @smoke', () => {
  test('tela de login carrega', async ({ page }) => {
    await page.goto('/login');
    await shot(page, 'smoke-login-inicio');
    await expect(page.getByTestId('login-form')).toBeVisible();
    await expect(page.getByTestId('email')).toBeVisible();
    await expect(page.getByTestId('password')).toBeVisible();
    await expect(page.getByTestId('login-btn')).toBeVisible();
    await shot(page, 'smoke-login-fim');
  });

  test('login do diretor funciona e cai numa tela autenticada', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await shot(page, 'smoke-diretor-logado');
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('senha errada mostra mensagem de erro', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('email').fill(USERS.diretorA.email);
    await page.getByTestId('password').fill('senha-errada');
    await page.getByTestId('login-btn').click();
    await expect(page.getByTestId('login-error')).toBeVisible({ timeout: 15_000 });
    await shot(page, 'smoke-login-erro');
  });
});
