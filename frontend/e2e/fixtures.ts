/**
 * Fixtures comuns aos testes E2E.
 */
import { type Page, expect, test } from '@playwright/test';

export const API_URL =
  process.env.E2E_API_URL ??
  process.env.VITE_API_URL ??
  'http://localhost:3001';

// Senha NUNCA hardcoded no repo — obrigatória via env/secret do CI.
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD ?? '';
if (!E2E_PASSWORD) {
  throw new Error('E2E_TEST_PASSWORD ausente — defina no env (secret do CI) antes de rodar os E2E');
}

export const TEST_USERS = {
  ADMIN: {
    email: process.env.E2E_TEST_EMAIL_ADMIN ?? process.env.E2E_TEST_EMAIL ?? 'admin@betinna.ai',
    password: E2E_PASSWORD,
  },
  DIRETOR: {
    email: process.env.E2E_TEST_EMAIL_DIRETOR ?? 'diretor@betinna.ai',
    password: E2E_PASSWORD,
  },
  GERENTE: {
    email: process.env.E2E_TEST_EMAIL_GERENTE ?? 'gerente@betinna.ai',
    password: E2E_PASSWORD,
  },
  REP: {
    email: process.env.E2E_TEST_EMAIL_REP ?? 'rep@betinna.ai',
    password: E2E_PASSWORD,
  },
};

/**
 * Login helper — autentica, dispensa onboarding tour, espera dashboard.
 *
 * Comportamentos:
 *  1. Injeta `window.__BETINNA_E2E__ = true` antes do goto, fazendo o
 *     auth-store expor `window.__authToken__` e `window.__empresaIdAtiva__`
 *     (apenas em testes — em prod sempre undefined por segurança).
 *  2. Se o login falhar com credenciais inválidas (ex: TEST_USERS.DIRETOR não
 *     existe no ambiente alvo), faz `test.skip` gracioso com mensagem clara
 *     ao invés de timeout enigmático. Permite rodar contra production que só
 *     tem ADMIN sem 80% das specs falharem por env.
 *  3. Dispensa automaticamente o OnboardingTour (modal que intercepta pointer
 *     events e quebra cliques subsequentes). Usa `data-testid=onboarding-skip`.
 */
export async function login(
  page: Page,
  creds: { email: string; password: string },
): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __BETINNA_E2E__: boolean }).__BETINNA_E2E__ = true;
  });
  await page.goto('/login');
  await page.getByTestId('email').fill(creds.email);
  await page.getByTestId('password').fill(creds.password);
  await page.getByTestId('login-btn').click();

  // Race: ou chega no dashboard (sucesso), ou aparece login-error (auth falhou)
  const outcome = await Promise.race([
    page
      .waitForURL(/\/dashboard/, { timeout: 10_000 })
      .then(() => 'success' as const)
      .catch(() => 'timeout' as const),
    page
      .getByTestId('login-error')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => 'auth-failed' as const)
      .catch(() => 'no-error' as const),
  ]);

  if (outcome === 'auth-failed') {
    test.skip(
      true,
      `Credenciais "${creds.email}" inválidas no ambiente alvo — provavelmente ` +
        `seed user não existe em produção. Esse teste só roda em staging/dev ` +
        `onde os 4 TEST_USERS são populados.`,
    );
    return;
  }
  if (outcome !== 'success') {
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5_000 });
  }

  // Dispensa onboarding tour se presente (intercepta pointer events e quebra
  // testes que clicam em UI após login). Falha silenciosa — tour pode não
  // aparecer (já dispensado em sessão anterior, flag em localStorage).
  await dismissOnboardingTour(page);
}

/**
 * Dispensa OnboardingTour silenciosamente. Pode ser chamado depois de qualquer
 * navegação (não só login) — o tour só aparece no 1º login por user+role.
 */
export async function dismissOnboardingTour(page: Page): Promise<void> {
  try {
    const skip = page.getByTestId('onboarding-skip');
    // Timeout curto: se não apareceu em 500ms, assume que já foi dispensado
    await skip.waitFor({ state: 'visible', timeout: 500 });
    await skip.click({ timeout: 2_000 });
    // Espera o tour sumir antes de retornar
    await page
      .getByTestId('onboarding-tour')
      .waitFor({ state: 'hidden', timeout: 2_000 })
      .catch(() => {
        /* ignore — flaky por animação, mas tour foi dispensado */
      });
  } catch {
    // Sem tour ativo — nada pra fazer
  }
}
