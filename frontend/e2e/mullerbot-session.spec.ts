import { test, expect } from '@playwright/test';
import { TEST_USERS, login } from './fixtures';

/**
 * MullerBot sessionId persistente (v1.3.0) — valida que o frontend gera
 * e persiste sessionId em localStorage pra contexto multi-turn server-side.
 *
 * Não testamos a resposta do OpenAI (custa $, requer API key configurada);
 * focamos no comportamento do frontend (presença + persistência do id).
 */

test('MullerBot — sessionId é gerado e salvo em localStorage na 1ª visita', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/mullerbot');
  // Espera o componente montar (state init lê localStorage)
  await expect(page.getByTestId('muller-input')).toBeVisible();
  const sessionId = await page.evaluate(() => localStorage.getItem('mullerbot_session_v2'));
  expect(sessionId).toBeTruthy();
  expect(sessionId!.length).toBeGreaterThan(8); // crypto.randomUUID = 36 chars
});

test('MullerBot — sessionId persiste entre reloads da página', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/mullerbot');
  await expect(page.getByTestId('muller-input')).toBeVisible();
  const sessionIdAntes = await page.evaluate(() => localStorage.getItem('mullerbot_session_v2'));
  expect(sessionIdAntes).toBeTruthy();

  // Reload
  await page.reload();
  await expect(page.getByTestId('muller-input')).toBeVisible();
  const sessionIdDepois = await page.evaluate(() =>
    localStorage.getItem('mullerbot_session_v2'),
  );
  expect(sessionIdDepois).toBe(sessionIdAntes);
});

test('MullerBot — input + botão Perguntar visíveis (UI sanity check)', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/mullerbot');
  await expect(page.getByTestId('muller-input')).toBeVisible();
  await expect(page.getByTestId('muller-send')).toBeVisible();
  // Top-K selector default = 5
  await expect(page.getByTestId('muller-topk')).toHaveValue('5');
});

test('MullerBot — sugestões aparecem no estado vazio (sem histórico)', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  // Garante histórico zerado neste teste
  await page.goto('/mullerbot');
  await page.evaluate(() => sessionStorage.removeItem('mullerbot_history_v2'));
  await page.reload();
  // Tela vazia mostra "Pergunte sobre o catálogo"
  await expect(page.locator('text=Pergunte sobre o catálogo')).toBeVisible();
  // E o card de Configurações na sidebar mantém top-K
  await expect(page.getByTestId('muller-topk')).toBeVisible();
});

test('MullerBot — Card "Como funciona" menciona contexto multi-turn', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/mullerbot');
  // String do card explicativo (v1.3.0 atualizada)
  await expect(
    page.locator('text=Contexto multi-turn persistido server-side'),
  ).toBeVisible();
});
