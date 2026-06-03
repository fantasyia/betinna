import { test, expect } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Autenticação — Camada 1 (@smoke).
 * Cobre o fluxo de sessão de ponta a ponta: login ok, login com senha errada,
 * logout, guarda de rota protegida (deslogado) e persistência após reload.
 *
 * Observações de implementação (conferidas no código real):
 * - logout-btn vive no rodapé do <Sidebar> (PageLayout.tsx). Em viewport desktop
 *   (Desktop Chrome, padrão do playwright.local.config) a sidebar está sempre
 *   visível; abaixo de 768px ela some pra fora da tela (drawer).
 * - logout-btn limpa a sessão e faz window.location.assign('/login') — navegação
 *   real, então basta esperar a URL virar /login.
 * - ProtectedRoute redireciona deslogado pra /login via <Navigate state={{from}}>:
 *   o `from` viaja no state do router, NÃO como query ?from=. Por isso só
 *   afirmamos que a URL é /login (sem checar querystring).
 * - Em todo reload o ProtectedRoute mostra <div data-testid="auth-bootstrap">
 *   enquanto o SDK restaura a sessão; por isso esperamos a sidebar (UI autenticada)
 *   em vez de checar a URL na hora.
 */
test.describe('Autenticação @smoke', () => {
  test('login com sucesso cai numa tela autenticada', async ({ page }) => {
    await page.goto('/login');
    await shot(page, 'auth-login-ok-inicio');

    await loginViaUI(page, USERS.diretorA.email);

    // Saiu de /login e a UI autenticada (sidebar) está montada.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 15_000 });
    await shot(page, 'auth-login-ok-fim');
  });

  test('login com senha errada mostra erro', async ({ page }) => {
    await page.goto('/login');
    await shot(page, 'auth-login-erro-inicio');

    await page.getByTestId('email').fill(USERS.diretorA.email);
    await page.getByTestId('password').fill('senha-errada-de-proposito');
    await page.getByTestId('login-btn').click();

    // Erro pode aparecer como mensagem inline no form OU como toast.
    const inlineErro = page.getByTestId('login-error');
    const toastErro = page.getByTestId('toast-error');
    await expect(inlineErro.or(toastErro).first()).toBeVisible({ timeout: 15_000 });

    // E não deve ter autenticado: continua em /login.
    await expect(page).toHaveURL(/\/login/);
    await shot(page, 'auth-login-erro-fim');
  });

  test('logout volta pra tela de login', async ({ page }) => {
    await page.goto('/login');
    await shot(page, 'auth-logout-inicio');

    await loginViaUI(page, USERS.diretorA.email);

    // logout-btn está no rodapé da sidebar (visível em desktop).
    const logout = page.getByTestId('logout-btn');
    await expect(logout).toBeVisible({ timeout: 15_000 });
    await logout.click();

    // clearSession() + window.location.assign('/login').
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByTestId('login-form')).toBeVisible({ timeout: 15_000 });
    await shot(page, 'auth-logout-fim');
  });

  test('rota protegida redireciona pra login quando deslogado', async ({ page }) => {
    await page.context().clearCookies();
    await shot(page, 'auth-protegida-inicio');

    await page.goto('/clientes');

    // ProtectedRoute manda pro /login (state.from preserva o destino).
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByTestId('login-form')).toBeVisible({ timeout: 15_000 });
    await shot(page, 'auth-protegida-fim');
  });

  test('sessão persiste após reload', async ({ page }) => {
    await page.goto('/login');
    await shot(page, 'auth-reload-inicio');

    await loginViaUI(page, USERS.diretorA.email);
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 15_000 });

    await page.reload();

    // Após o F5 o ProtectedRoute restaura a sessão (mostra auth-bootstrap por um
    // instante). Esperamos a UI autenticada voltar e garantimos que NÃO caímos
    // em /login.
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/login/);
    await shot(page, 'auth-reload-fim');
  });
});
