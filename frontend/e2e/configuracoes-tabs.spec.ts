import { test, expect } from '@playwright/test';
import { TEST_USERS, login } from './fixtures';

/**
 * ConfiguracoesPage tabs — valida estrutura 2 abas:
 *   🏢 Empresas (default) / ⚙️ Avançado
 *
 * Cobertura: troca de aba via click, conteúdo correto por aba, ARIA
 * (role=tab + aria-selected).
 */

test('Configurações — abre na aba Empresas por default', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/configuracoes');
  const empresasTab = page.getByTestId('config-tab-empresas');
  await expect(empresasTab).toBeVisible();
  await expect(empresasTab).toHaveAttribute('aria-selected', 'true');
  // FilterBar (search + select ativo) é específico da aba Empresas
  await expect(page.getByPlaceholder(/Nome, CNPJ/i)).toBeVisible();
});

test('Configurações — aba Avançado mostra hub de atalhos', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/configuracoes');
  await page.getByTestId('config-tab-avancado').click();
  // Tem header da seção
  await expect(page.locator('text=Áreas administrativas relacionadas')).toBeVisible();
  // Usa data-testid dedicado pra evitar conflito com link na sidebar nav
  // (que também aponta /integracoes — strict mode violaria sem escopo).
  await expect(page.getByTestId('config-link-integracoes')).toBeVisible();
  await expect(page.getByTestId('config-link-permissoes')).toBeVisible();
});

test('Configurações — botão "+ Nova empresa" só aparece na aba Empresas', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/configuracoes');
  // Default = Empresas → botão visível
  await expect(page.getByTestId('emp-new')).toBeVisible();
  // Vai pra Avançado → some
  await page.getByTestId('config-tab-avancado').click();
  await expect(page.getByTestId('emp-new')).not.toBeVisible();
  // Volta → reaparece
  await page.getByTestId('config-tab-empresas').click();
  await expect(page.getByTestId('emp-new')).toBeVisible();
});

test('Configurações — tab strip tem role=tablist com 2 tabs', async ({ page }) => {
  await login(page, TEST_USERS.ADMIN);
  await page.goto('/configuracoes');
  const tablist = page.locator('[role="tablist"]');
  await expect(tablist).toBeVisible();
  const tabs = tablist.locator('[role="tab"]');
  await expect(tabs).toHaveCount(2);
});
