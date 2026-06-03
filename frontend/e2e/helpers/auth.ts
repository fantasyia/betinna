import { type Page, expect } from '@playwright/test';
import { TEST_PASSWORD } from '../fixtures/users';

/**
 * Impede o tour de onboarding de aparecer durante os testes.
 * Ele é um modal que cobre a tela no 1º acesso de cada usuário e intercepta
 * cliques — puro ruído de teste. Fingimos que já foi visto (flag em localStorage
 * `onboarding:done:<userId>:<role>`). Chamado antes de navegar.
 */
export async function suppressOnboarding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const orig = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string): string | null {
        if (typeof key === 'string' && key.startsWith('onboarding:done:')) return '1';
        return orig.call(this, key);
      };
    } catch {
      /* ambiente sem Storage — ignora */
    }
  });
}

/**
 * Faz login pela UI (exercita o fluxo real de auth) e espera sair de /login.
 * Use nos testes que precisam de uma sessão autenticada.
 */
export async function loginViaUI(
  page: Page,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<void> {
  await suppressOnboarding(page);
  await page.goto('/login');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('login-btn').click();
  // Login bem-sucedido redireciona pra fora de /login.
  await expect(page, `login falhou para ${email}`).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

/**
 * Screenshot nomeado em e2e/output/screenshots — usado pra capturar
 * início / meio / fim de cada teste (revisão humana posterior).
 */
export async function shot(page: Page, nome: string): Promise<void> {
  await page.screenshot({ path: `e2e/output/screenshots/${nome}.png`, fullPage: true });
}
