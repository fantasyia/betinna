import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Relatórios — abas + período + export (Fase 2, roteiro por área).
 *
 * Padrão herdado do clientes.spec: login pela UI (diretorA tem relatorios.view),
 * navega pra /relatorios e exercita as 7 abas, o seletor de período e os botões
 * de export, contra frontend(5174)+backend(4001).
 *
 * Seletores reais (lidos de RelatoriosPage.tsx + StateView.tsx + ErrorBoundary.tsx):
 *  - Título da página ......... testid `page-title` (<h1> em PageLayout)
 *  - Seletor de período ....... testid `periodo-select` (<select>: mes|trimestre|semestre|ano)
 *  - Abas (role=tab) .......... testid `relatorios-tab-{overview|vendas|funil|comissoes|sac|amostras|campanhas}`
 *  - Export ................... testid `export-csv` / `export-xlsx` / `export-pdf`
 *                               (cada tab tem o seu; DESABILITADOS quando a aba não tem linhas)
 *  - Erro de fetch ............ testid `state-error` (StateView)
 *  - Crash de render .......... testid `error-boundary-fallback` / texto "Algo deu errado"
 *  - Toast de erro ............ testid `toast-error`
 *
 * NOTA: a aba `overview` NÃO tem botões de export (só KPIs+gráficos). Os exports
 * vivem nas abas vendas/funil/comissoes/sac/amostras/campanhas.
 */

const TABS = [
  'overview',
  'vendas',
  'funil',
  'comissoes',
  'sac',
  'amostras',
  'campanhas',
] as const;

const PERIODOS = ['mes', 'trimestre', 'semestre', 'ano'] as const;

async function semValoresQuebrados(page: Page): Promise<void> {
  const body = page.locator('body');
  await expect(body).not.toContainText('NaN');
  await expect(body).not.toContainText('Invalid Date');
}

async function semCrash(page: Page): Promise<void> {
  await expect(page.getByTestId('error-boundary-fallback')).toHaveCount(0);
}

/**
 * Abre uma aba e espera ela assentar: o StateView de loading some e nem o
 * ErrorBoundary nem o erro de fetch aparecem.
 */
async function abrirAba(page: Page, tab: (typeof TABS)[number]): Promise<void> {
  await page.getByTestId(`relatorios-tab-${tab}`).click();
  // Cada aba refaz o fetch ⇒ pode reabrir o skeleton. Espera ele sair.
  await expect(page.getByTestId('state-loading')).toHaveCount(0, { timeout: 15_000 });
  await semCrash(page);
}

// ─────────────────────────────────────────────────────────────────────────
test.describe('Relatórios @regression', () => {
  test('/relatorios carrega sem valores quebrados', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/relatorios');
    await shot(page, 'relatorios-carrega-inicio');

    // Título + aba default (overview) assentada.
    await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('page-title')).toHaveText('Relatórios');
    await expect(page.getByTestId('state-loading')).toHaveCount(0, { timeout: 15_000 });

    await semCrash(page);
    await semValoresQuebrados(page);
    await shot(page, 'relatorios-carrega-fim');
  });

  test('troca entre todas as abas sem quebrar', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/relatorios');
    await shot(page, 'relatorios-abas-inicio');

    await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 15_000 });

    // Percorre cada aba, confirma que está selecionada e que nada quebra.
    for (const tab of TABS) {
      const botao = page.getByTestId(`relatorios-tab-${tab}`);
      await expect(botao, `aba ${tab} deve existir`).toBeVisible({ timeout: 15_000 });
      await abrirAba(page, tab);

      // aria-selected confirma que o clique trocou a aba ativa.
      await expect(botao).toHaveAttribute('aria-selected', 'true');
      // Conteúdo da aba não imprimiu NaN/Invalid Date.
      await semValoresQuebrados(page);
    }
    await shot(page, 'relatorios-abas-fim');
  });

  test('seletor de período muda o período sem quebrar', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/relatorios');
    await shot(page, 'relatorios-periodo-inicio');

    const seletor = page.getByTestId('periodo-select');
    await expect(seletor).toBeVisible({ timeout: 15_000 });

    // Aplica cada período e confirma que a tela reage sem crash nem valor quebrado.
    for (const p of PERIODOS) {
      await seletor.selectOption(p);
      await expect(seletor).toHaveValue(p);
      await expect(page.getByTestId('state-loading')).toHaveCount(0, { timeout: 15_000 });
      await semCrash(page);
      await semValoresQuebrados(page);
    }
    await shot(page, 'relatorios-periodo-fim');
  });

  test('botões de export presentes e CSV não dispara erro', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/relatorios');
    await shot(page, 'relatorios-export-inicio');

    await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 15_000 });

    // Overview não tem export — vai pra aba "vendas", que renderiza os 3 botões.
    await abrirAba(page, 'vendas');

    const csv = page.getByTestId('export-csv');
    const xlsx = page.getByTestId('export-xlsx');
    const pdf = page.getByTestId('export-pdf');

    // Os 3 botões devem existir/estar visíveis na aba.
    await expect(csv).toBeVisible({ timeout: 15_000 });
    await expect(xlsx).toBeVisible();
    await expect(pdf).toBeVisible();
    await shot(page, 'relatorios-export-meio');

    // Os botões ficam DESABILITADOS quando a aba não tem linhas (porRep vazio).
    // Se estiver desabilitado, não há o que clicar — registramos e seguimos só
    // com a checagem de presença (não é um bug: é o estado vazio legítimo).
    const csvHabilitado = await csv.isEnabled();
    if (!csvHabilitado) {
      test.info().annotations.push({
        type: 'nota',
        description:
          'export-csv desabilitado na aba vendas (dataset sem linhas). Só validada a presença.',
      });
    } else {
      // O clique pode disparar um download de verdade. Capturamos o evento com
      // try/catch pra não travar caso o browser não emita (ex: data: URL).
      const downloadPromise = page
        .waitForEvent('download', { timeout: 5_000 })
        .catch(() => null);
      await csv.click();
      await downloadPromise;
    }

    // O que IMPORTA: o export não pode ter gerado erro. Sem toast-error e sem crash.
    await expect(page.getByTestId('toast-error')).toHaveCount(0);
    await semCrash(page);
    await shot(page, 'relatorios-export-fim');
  });
});
