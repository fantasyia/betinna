import { test, expect } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Admin — painel operacional (AdminPage.tsx).
 *
 * Login: USERS.admin (ADMIN da plataforma). /admin exige permission
 * 'admin.panel' (App.tsx requirePermission). Front+back reais (5174 + 4001).
 *
 * NÃO clica `backup-run` (dispara pg_dump real no Supabase local — pode demorar).
 * Apenas confirma que os botões de backup EXISTEM.
 *
 * Seções (todas testid reais lidos do componente):
 *  - System status ............ /version + /health via StateView.
 *                               Stats: API status, Uptime, Versão, Ambiente…
 *  - DB health ................ refresh `db-health-refresh` → total `db-health-total`
 *                               (mostra data.totalFmt — string formatada, ex "12 MB")
 *  - Backup ................... botões `backup-run` / `backup-verify` (NÃO clicar run)
 *  - Audit log ................ refresh `audit-refresh` (+ Table via StateView)
 *  - Dead-letter .............. refresh `dlq-refresh` (+ Table via StateView)
 *
 * Nota: SystemStatus/DbHealth usam fmtUptime/fmtDate que guardam contra valores
 * inválidos; ainda assim verificamos que não há "NaN" renderizado.
 */

const ADMIN_URL = '/admin';

test.describe('Admin @regression', () => {
  test('página carrega com status do sistema (versão/uptime) sem NaN', async ({ page }) => {
    await loginViaUI(page, USERS.admin.email);
    await page.goto(ADMIN_URL);
    await shot(page, 'admin-carrega-inicio');

    // Título do painel.
    await expect(page.getByRole('heading', { name: /Painel Admin/i })).toBeVisible({
      timeout: 15_000,
    });

    // Bloco "Status do sistema" deve aparecer e sair do loading.
    await expect(page.getByRole('heading', { name: /Status do sistema/i })).toBeVisible({
      timeout: 15_000,
    });

    // Os rótulos dos stats são fixos no componente — confirmam que o StateView
    // resolveu e renderizou o grid (não ficou em loading/erro).
    await expect(page.getByText('API status', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Uptime', { exact: true })).toBeVisible();
    await expect(page.getByText('Versão', { exact: true })).toBeVisible();
    await shot(page, 'admin-carrega-meio');

    // BUG REAL a pegar: uptime/versão quebrados renderizariam "NaN". A página
    // inteira não deve conter "NaN".
    await expect(page.locator('body').getByText(/NaN/)).toHaveCount(0);
    await shot(page, 'admin-carrega-fim');
  });

  test('DB health: refresh traz o tamanho total do banco', async ({ page }) => {
    await loginViaUI(page, USERS.admin.email);
    await page.goto(ADMIN_URL);
    await shot(page, 'admin-dbhealth-inicio');

    await expect(page.getByRole('heading', { name: /Saúde do banco/i })).toBeVisible({
      timeout: 15_000,
    });

    // Dispara o refresh do DB health.
    const refresh = page.getByTestId('db-health-refresh');
    await expect(refresh).toBeVisible({ timeout: 15_000 });
    await refresh.click();
    await shot(page, 'admin-dbhealth-meio');

    // O total (db-health-total) aparece com um tamanho não-vazio (totalFmt é
    // string formatada, ex "12 MB"). Não deve estar vazio nem "NaN".
    const total = page.getByTestId('db-health-total');
    await expect(total).toBeVisible({ timeout: 20_000 });
    const txt = (await total.textContent())?.trim() ?? '';
    expect(txt.length, 'db-health-total deveria mostrar um tamanho').toBeGreaterThan(0);
    expect(txt).not.toMatch(/nan/i);
    await shot(page, 'admin-dbhealth-fim');
  });

  test('audit log: refresh carrega sem quebrar', async ({ page }) => {
    await loginViaUI(page, USERS.admin.email);
    await page.goto(ADMIN_URL);
    await shot(page, 'admin-audit-inicio');

    await expect(page.getByRole('heading', { name: /Audit log/i })).toBeVisible({
      timeout: 15_000,
    });

    const refresh = page.getByTestId('audit-refresh');
    await expect(refresh).toBeVisible({ timeout: 15_000 });
    await refresh.click();
    await shot(page, 'admin-audit-meio');

    // Carregou sem cair em erro de fetch: a seção não deve mostrar o estado de
    // erro do StateView (testid state-error). Vazio é aceitável (emptyMessage).
    // Espera o loading da seção resolver.
    await expect(async () => {
      const loadings = await page.getByTestId('state-loading').count();
      expect(loadings).toBe(0);
    }).toPass({ timeout: 20_000 });
    await expect(page.getByTestId('state-error')).toHaveCount(0);
    await shot(page, 'admin-audit-fim');
  });

  test('dead-letter: refresh carrega sem quebrar', async ({ page }) => {
    await loginViaUI(page, USERS.admin.email);
    await page.goto(ADMIN_URL);
    await shot(page, 'admin-dlq-inicio');

    await expect(page.getByRole('heading', { name: /Dead-letter queue/i })).toBeVisible({
      timeout: 15_000,
    });

    const refresh = page.getByTestId('dlq-refresh');
    await expect(refresh).toBeVisible({ timeout: 15_000 });
    await refresh.click();
    await shot(page, 'admin-dlq-meio');

    // Sem erro de fetch após o refresh. (Lista vazia mostra
    // "🎉 Nenhum job no dead-letter" — também é OK.)
    await expect(async () => {
      const loadings = await page.getByTestId('state-loading').count();
      expect(loadings).toBe(0);
    }).toPass({ timeout: 20_000 });
    await expect(page.getByTestId('state-error')).toHaveCount(0);
    await shot(page, 'admin-dlq-fim');
  });

  test('backup: botões existem mas NÃO são acionados (run não clicado)', async ({ page }) => {
    await loginViaUI(page, USERS.admin.email);
    await page.goto(ADMIN_URL);
    await shot(page, 'admin-backup-inicio');

    // Card de backup só renderiza pra ADMIN (BackupSection retorna null senão).
    await expect(page.getByTestId('backup-card')).toBeVisible({ timeout: 15_000 });

    // Confirma que os dois botões existem, sem acionar o backup real.
    await expect(page.getByTestId('backup-run')).toBeVisible();
    await expect(page.getByTestId('backup-verify')).toBeVisible();
    // Deliberadamente NÃO clicamos backup-run nem backup-verify
    // (pg_dump/pg_restore reais — lentos no Supabase local).
    await shot(page, 'admin-backup-fim');
  });
});
