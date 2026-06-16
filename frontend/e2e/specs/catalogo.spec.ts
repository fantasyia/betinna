import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Catálogo — listagem / estado / formatação (Fase 2, roteiro por área).
 *
 * Login pela UI como diretorA (empresa A) → /catalogo. Exercita o fluxo real
 * contra frontend(5174)+backend(4001). Resiliente a dados: o catálogo do seed
 * pode estar VAZIO (os 20 produtos da empresa A existem em /produtos, mas o
 * catálogo é uma curadoria separada que começa vazia). Por isso o teste cobre
 * os dois caminhos — vazio (EmptyState amigável) ou com itens (cards + R$).
 *
 * Seletores reais (lidos de CatalogoPage.tsx + PageLayout + EmptyState + Stat):
 *  - Título da página ......... testid `page-title` (PageLayout, desktop) → "Meu catálogo"
 *  - Stats no topo ............ componente <Stat> (sem testid) → labels
 *                               "Produtos no catálogo" / "Sem estoque"
 *  - Busca .................... <Input> placeholder "Buscar por nome, SKU, marca…" (sem testid)
 *  - Adicionar produto ........ testid `catalogo-add`
 *  - Preview por cliente ...... testid `catalogo-preview`  (label só "Preview"; disabled se vazio)
 *  - Compartilhar ............. testid `catalogo-share`     (disabled se vazio)
 *  - Limpar tudo .............. testid `catalogo-clear`     (só aparece com >5 itens)
 *  - Banner de sync ........... testid `catalogo-sync-banner` (só com itens)
 *  - Card de produto .......... SEM testid no card; cada card tem stock-{id} →
 *                               uso `[data-testid^="stock-"]` como proxy de "card existe".
 *  - Estado vazio ............. <EmptyState> com <h3> "Catálogo vazio" (ou
 *                               "Nenhum produto bate com a busca" quando há busca).
 *  - Preços ................... fmtBRL → Intl pt-BR currency BRL ⇒ contém "R$".
 *
 * NOTA de divergência com o roteiro: o botão pedido como "Preview por cliente"
 * renderiza com label "Preview" (testid catalogo-preview); o de "Adicionar
 * produto" é catalogo-add. Sem testid `catalogo-grid` — uso o conjunto de
 * markup-inputs como sinal de grid populado.
 */

/** Cards de produto — cada um expõe um stock badge com o produtoId no testid. */
function cards(page: Page) {
  return page.locator('[data-testid^="stock-"]');
}

/**
 * Lê o <body> inteiro e falha se houver lixo de render típico de bug de dados:
 * "NaN", "Invalid Date" ou "undefined" aparecendo como texto pro usuário.
 * (Mesmo critério usado nos outros specs de regressão.)
 */
async function assertSemLixoDeRender(page: Page) {
  const body = (await page.locator('body').innerText()).trim();
  expect(body, 'body não deveria conter "NaN"').not.toMatch(/\bNaN\b/);
  expect(body, 'body não deveria conter "Invalid Date"').not.toContain('Invalid Date');
  expect(body, 'body não deveria conter "undefined"').not.toContain('undefined');
}

test.describe('Catálogo @regression', () => {
  test('página carrega sem lixo de render (NaN/Invalid Date/undefined)', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/catalogo');
    await shot(page, 'catalogo-carrega-inicio');

    // Cabeçalho da página confirma que a tela montou (não caiu em /403 nem branco).
    await expect(page.getByTestId('page-title')).toHaveText('Meu catálogo', { timeout: 15_000 });

    // Stats sempre presentes (mesmo com catálogo vazio: contam 0).
    await expect(page.getByText('Produtos no catálogo')).toBeVisible();
    await expect(page.getByText('Sem estoque', { exact: true })).toBeVisible();

    // Espera o fetch de /catalogo resolver: ou aparecem cards, ou o EmptyState.
    // (StateView mostra skeleton testid=state-loading enquanto carrega.)
    await expect(page.getByTestId('state-loading')).toHaveCount(0, { timeout: 15_000 });

    await assertSemLixoDeRender(page);
    await shot(page, 'catalogo-carrega-fim');
  });

  test('grid de cards OU estado vazio amigável aparece', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/catalogo');
    await shot(page, 'catalogo-grid-inicio');

    await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('state-loading')).toHaveCount(0, { timeout: 15_000 });

    // Resiliente a dados: o catálogo pode estar vazio (seed não popula curadoria).
    // Exatamente um dos dois estados deve valer.
    const n = await cards(page).count();

    if (n === 0) {
      // Estado vazio amigável: EmptyState com título "Catálogo vazio".
      await expect(
        page.getByRole('heading', { name: 'Catálogo vazio' }),
      ).toBeVisible({ timeout: 15_000 });
      // E a ação de adicionar deve estar oferecida (CTA do EmptyState + toolbar).
      await expect(page.getByTestId('catalogo-add')).toBeVisible();
      await shot(page, 'catalogo-grid-vazio');
    } else {
      // Catálogo populado: há cards e as ações ficam habilitadas.
      expect(n).toBeGreaterThan(0);
      await expect(cards(page).first()).toBeVisible();
      await expect(page.getByTestId('catalogo-share')).toBeEnabled();
      await expect(page.getByTestId('catalogo-preview')).toBeEnabled();
      // Banner de sync só renderiza com itens.
      await expect(page.getByTestId('catalogo-sync-banner')).toBeVisible();
      await shot(page, 'catalogo-grid-populado');
    }

    // Os botões de ação principais existem independentemente do estado.
    await expect(page.getByTestId('catalogo-add')).toBeVisible();
    await expect(page.getByTestId('catalogo-preview')).toBeVisible();
    await expect(page.getByTestId('catalogo-share')).toBeVisible();
    await shot(page, 'catalogo-grid-fim');
  });

  test('quando há itens, preços aparecem formatados em R$ sem NaN', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/catalogo');
    await shot(page, 'catalogo-precos-inicio');

    await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('state-loading')).toHaveCount(0, { timeout: 15_000 });

    const n = await cards(page).count();
    // Catálogo vazio neste seed → não há preço pra checar; pula com anotação.
    test.skip(n === 0, 'Catálogo vazio neste dataset — sem preços de card pra validar.');

    // Cada card mostra o preço (tabela MSM) via fmtBRL (Intl BRL ⇒ "R$").
    // Confirma que existe pelo menos um "R$" renderizado e nenhum "R$ NaN".
    await expect(page.getByText(/R\$\s?\d/).first()).toBeVisible();

    const body = (await page.locator('body').innerText()).trim();
    expect(body, 'preço quebrado: "R$ NaN" no catálogo').not.toMatch(/R\$\s*NaN/);
    expect(body).not.toMatch(/\bNaN\b/);
    expect(body).not.toContain('Invalid Date');
    await shot(page, 'catalogo-precos-fim');
  });
});
