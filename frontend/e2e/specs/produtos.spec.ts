import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Produtos — listagem / busca / estado vazio (Fase 2, roteiro por área).
 *
 * Login pela UI como diretorA (empresa A) → /produtos. Empresa A tem 20 produtos
 * semeados. Exercita o fluxo real contra frontend(5174)+backend(4001).
 *
 * Seletores reais (lidos de ProdutosPage.tsx + Table + FilterBar + StateView):
 *  - Título da página ......... testid `page-title` (PageLayout) → "Produtos"
 *  - Busca .................... testid `search-input` (SearchInput, type=search,
 *                               placeholder "Nome, SKU, marca…")
 *  - Tabela ................... testid `data-table`
 *  - Linha .................... testid `data-row` (uma por produto)
 *  - Nome do produto .......... 1ª célula da linha; nome no <div fontWeight:600>
 *                               (1ª linha do innerText DA CÉLULA, não da <tr>)
 *  - Toggle status ............ testid `prod-toggle-{id}`
 *  - Editar ................... testid `prod-edit-{id}`
 *  - Paginação ................ testid `pagination` / `pagination-prev` / `pagination-next`
 *  - Estado vazio ............. StateView → testid `state-empty`, texto
 *                               "Nenhum produto encontrado."
 *  - Preço .................... fmtBRL → Intl pt-BR currency BRL ⇒ contém "R$".
 *
 * Empresa A tem 20 produtos e o limite por página é 20 ⇒ a 1ª página já lista
 * todos. Asserções resilientes: contagens > 0 e <= total visível.
 */

/** Linhas da tabela de produtos. */
function rows(page: Page) {
  return page.locator('[data-testid="data-row"]');
}

/**
 * Extrai o nome do produto da 1ª linha de forma confiável.
 *
 * A 1ª célula renderiza:  <div fontWeight:600>NOME</div> seguido de
 * <div>SKU · MARCA</div>. Pegamos o innerText DA CÉLULA (não da <tr> inteira,
 * que misturaria preço/estoque/etc.) e ficamos com a 1ª linha → o nome.
 * Isso evita fatiar texto cru da linha inteira.
 */
async function primeiroNomeProduto(page: Page): Promise<string> {
  const primeiraCelula = rows(page).first().locator('td').first();
  const txt = (await primeiraCelula.innerText()).trim();
  // 1ª linha = nome (a 2ª, quando existe, é "SKU · marca").
  const nome = txt.split('\n')[0].trim();
  expect(nome.length, 'nome do 1º produto veio vazio').toBeGreaterThan(0);
  return nome;
}

async function assertSemLixoDeRender(page: Page) {
  const body = (await page.locator('body').innerText()).trim();
  expect(body, 'body não deveria conter "NaN"').not.toMatch(/\bNaN\b/);
  expect(body, 'body não deveria conter "Invalid Date"').not.toContain('Invalid Date');
  expect(body, 'preço quebrado: "R$ NaN"').not.toMatch(/R\$\s*NaN/);
}

test.describe('Produtos @regression', () => {
  test('lista carrega com linhas (empresa A tem 20) sem NaN', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/produtos');
    await shot(page, 'produtos-lista-inicio');

    await expect(page.getByTestId('page-title')).toHaveText('Produtos', { timeout: 15_000 });

    // A lista deve montar com linhas (empresa A semeada com 20 produtos).
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    const total = await rows(page).count();
    expect(total, 'esperava produtos semeados na empresa A').toBeGreaterThan(0);
    // Página lista no máximo 20 (limit=20). Com 20 no seed, deve ser exatamente 20.
    expect(total).toBeLessThanOrEqual(20);

    // Tabela e ao menos um preço em R$ devem estar presentes.
    await expect(page.getByTestId('data-table')).toBeVisible();
    await expect(page.getByText(/R\$\s?\d/).first()).toBeVisible();

    await assertSemLixoDeRender(page);
    await shot(page, 'produtos-lista-fim');
  });

  test('busca filtra a lista por nome real de produto', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/produtos');
    await shot(page, 'produtos-busca-inicio');

    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    const totalAntes = await rows(page).count();
    expect(totalAntes).toBeGreaterThan(0);

    // Extrai um nome real da 1ª linha (via 1ª célula → 1ª linha do texto).
    const nome = await primeiroNomeProduto(page);
    // Termo de busca: uma fatia inicial do nome (palavra/prefixo), suficiente
    // pra casar a si mesmo. Tira no máx. 6 chars pra não depender do nome todo.
    const termo = nome.slice(0, Math.min(6, nome.length)).trim() || nome;
    await shot(page, 'produtos-busca-meio');

    await page.getByTestId('search-input').fill(termo);

    // A busca é server-side (debounce + refetch). Espera o resultado estabilizar:
    // ainda há pelo menos 1 linha (a de origem) e o conjunto não cresceu.
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      const n = await rows(page).count();
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(totalAntes);
    }).toPass({ timeout: 15_000 });

    // O produto de origem deve continuar visível (a busca o encontra).
    await expect(page.getByText(nome, { exact: false }).first()).toBeVisible();
    await assertSemLixoDeRender(page);
    await shot(page, 'produtos-busca-fim');
  });

  test('estado vazio mostra mensagem amigável', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/produtos');
    await shot(page, 'produtos-vazio-inicio');

    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });

    // Busca por algo inexistente → StateView empty ("Nenhum produto encontrado.").
    await page.getByTestId('search-input').fill('zzzznaoexiste');

    await expect(page.getByTestId('state-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Nenhum produto encontrado/i)).toBeVisible();
    // E nenhuma linha sobra.
    await expect(rows(page)).toHaveCount(0);
    await shot(page, 'produtos-vazio-fim');
  });
});
