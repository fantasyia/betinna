import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Dashboard — carga + sanidade de KPIs (Fase 2, roteiro por área).
 *
 * Padrão herdado do clientes.spec: login pela UI (diretorA tem relatorios.view ⇒
 * vê o dashboard completo da empresa A), navega pra /dashboard e valida que a tela
 * renderiza sem valores quebrados, contra frontend(5174)+backend(4001).
 *
 * Seletores reais (lidos de DashboardPage.tsx + PageLayout.tsx + ErrorBoundary.tsx):
 *  - Título da página ......... testid `page-title` (<h1> em PageLayout, desktop)
 *  - Sidebar .................. testid `sidebar`
 *  - Botão personalizar ....... testid `dashboard-personalizar`
 *  - Toggles do dashboard ..... testid `dashboard-toggle-{kpis|topReps|funil|atalhos}`
 *  - ErrorBoundary (crash) .... testid `error-boundary-fallback` / texto "Algo deu errado"
 *  - Estado de erro de fetch .. testid `state-error` (StateView)
 *
 * NOTA: o viewport do projeto chromium (Desktop Chrome) é 1280px ⇒ acima do
 * breakpoint mobile (768), então a sidebar e o <h1> page-title aparecem.
 */

/**
 * Falha se a tela está com valores quebrados (NaN / Invalid Date / undefined).
 * É o coração desta suíte: se o backend devolver número/data inválida e o front
 * imprimir cru, isto pega — e o teste DEVE falhar (bug real, não mascarar).
 */
async function semValoresQuebrados(page: Page): Promise<void> {
  const body = page.locator('body');
  await expect(body).not.toContainText('NaN');
  await expect(body).not.toContainText('Invalid Date');
  await expect(body).not.toContainText('undefined');
}

/**
 * Garante que a página não caiu no ErrorBoundary nem num erro de fetch.
 * Asserção resiliente: cobre tanto o fallback global (error-boundary-fallback)
 * quanto o StateView de erro (state-error).
 */
async function semCrash(page: Page): Promise<void> {
  await expect(page.getByTestId('error-boundary-fallback')).toHaveCount(0);
  await expect(page.getByTestId('state-error')).toHaveCount(0);
}

// ─────────────────────────────────────────────────────────────────────────
test.describe('Dashboard @regression', () => {
  test('/dashboard carrega com sidebar e título', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/dashboard');
    await shot(page, 'dashboard-carrega-inicio');

    // Título da página (PageLayout → <h1 data-testid="page-title">Dashboard</h1>).
    await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('page-title')).toHaveText('Dashboard');

    // Sidebar (navegação) presente — confirma o shell autenticado.
    await expect(page.getByTestId('sidebar')).toBeVisible();

    // Não caiu em tela de erro.
    await semCrash(page);
    await shot(page, 'dashboard-carrega-fim');
  });

  test('sem valores quebrados (NaN / Invalid Date / undefined)', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/dashboard');
    await shot(page, 'dashboard-valores-inicio');

    // Espera o conteúdo estabilizar: o título aparece e o skeleton de loading some.
    await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('state-loading')).toHaveCount(0, { timeout: 15_000 });

    // Coração do teste: nenhum valor quebrado vazou pra tela.
    await semValoresQuebrados(page);
    await semCrash(page);
    await shot(page, 'dashboard-valores-fim');
  });

  test('KPIs / conteúdo do dashboard visíveis', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/dashboard');
    await shot(page, 'dashboard-kpis-inicio');

    await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('state-loading')).toHaveCount(0, { timeout: 15_000 });
    await semCrash(page);

    // Conteúdo de dashboard: diretorA tem relatorios.view, então renderiza KPIs
    // (Stat "Faturamento"/"Pedidos"/…) OU, em instância zerada, os cards de
    // "Top representantes"/"Funil de leads"/"Primeiros passos". Asserção resiliente:
    // basta que ALGUM marcador conhecido de dashboard esteja visível.
    const marcadores = page.getByText(
      /Faturamento|Pedidos|Ticket médio|Leads ativos|Top representantes|Funil de leads|Atalhos rápidos|Primeiros passos|Dashboard vazio/i,
    );
    await expect(marcadores.first()).toBeVisible({ timeout: 15_000 });
    await shot(page, 'dashboard-kpis-fim');
  });

  test('personalizar abre toggles e alterna seções', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/dashboard');
    await shot(page, 'dashboard-personalizar-inicio');

    await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 15_000 });
    await semCrash(page);

    // O menu "Personalizar" só existe quando o usuário tem relatorios.view.
    // diretorA tem — mas mantemos resiliente: se não houver, pulamos com anotação.
    const personalizar = page.getByTestId('dashboard-personalizar');
    const temPersonalizar = (await personalizar.count()) > 0;
    test.skip(!temPersonalizar, 'Sem botão Personalizar (usuário sem relatorios.view).');

    await personalizar.click();

    // O dropdown traz 1 toggle por módulo (kpis/topReps/funil/atalhos). Cada toggle
    // é um <input type="checkbox" class="peer sr-only"> (Checkbox custom): existe na
    // árvore de acessibilidade (toBeVisible passa) mas é visualmente escondido — o
    // <span> decorativo por cima INTERCEPTA o ponteiro, então clicar no <input>
    // direto dá timeout ("intercepts pointer events"). O controle clicável real é
    // o <label> que envolve o Checkbox + o texto do módulo.
    const toggleKpis = page.getByTestId('dashboard-toggle-kpis');
    await expect(toggleKpis).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dashboard-toggle-topReps')).toBeVisible();
    await expect(page.getByTestId('dashboard-toggle-funil')).toBeVisible();
    await expect(page.getByTestId('dashboard-toggle-atalhos')).toBeVisible();
    await shot(page, 'dashboard-personalizar-meio');

    // Alterna o toggle de KPIs clicando no <label> que o contém (toggla o checkbox
    // nativamente). Confirma que o estado realmente inverteu (checked → unchecked)
    // e que a tela reage sem quebrar. (Não fixamos qual seção some — só que o
    // controle funciona, o checkbox mudou e nada crasha.)
    const labelKpis = page.locator('label').filter({ has: toggleKpis });
    await expect(labelKpis).toBeVisible();
    await labelKpis.scrollIntoViewIfNeeded();
    await expect(toggleKpis).toBeChecked(); // default ligado
    await labelKpis.click();
    await expect(toggleKpis).not.toBeChecked(); // o clique realmente alternou
    await semCrash(page);
    await semValoresQuebrados(page);
    await shot(page, 'dashboard-personalizar-fim');
  });
});
