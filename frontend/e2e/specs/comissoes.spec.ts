import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Comissões — visão DIRECTOR (rota /comissoes).
 *
 * Padrão herdado de clientes.spec.ts: login com diretorA (DIRECTOR), navega pra
 * /comissoes e exercita o fluxo real contra frontend(5174)+backend(4001).
 *
 * ── Selectors reais (lidos de ComissoesPage.tsx + Table.tsx + FilterBar) ────
 * Permissões (usePermission.ts): DIRECTOR tem `comissoes.all` mas NÃO
 * `comissoes.own`. Logo, em /comissoes o DIRECTOR vê APENAS o bloco <ListaAdmin>
 * ("Comissões da equipe") — o "Meu resumo" (<ResumoPessoal>) NÃO renderiza.
 *  - Título do bloco ........ getByText('Comissões da equipe')
 *  - "Fechar mês" ........... data-testid="fechar-mes-btn" (só DIRECTOR/ADMIN)
 *  - Filtros (FilterBar):
 *      • data-testid="filter-mes"  (Todos meses | Jan…Dez)
 *      • data-testid="filter-ano"  (ano-1 | ano | ano+1)
 *      • data-testid="filter-pago" ("" Pagos+abertos | "true" | "false")
 *  - Tabela ................. data-testid="data-table" ; linhas "data-row"
 *      colunas: Período, Representante, Vendido (R$), % , Comissão (R$), Status
 *  - Vazio .................. StateView empty → data-testid="state-empty"
 *      (emptyMessage "Nenhuma comissão encontrada nesse filtro.")
 *  - Valores em R$ .......... fmtBRL (Intl) ; % via fmtPct (guarda Number.isFinite).
 *      Asserção dura: a tela NÃO pode conter "NaN".
 *
 * AÇÕES FINANCEIRAS — NÃO EXECUTAR de verdade:
 *  - NÃO clicar "Fechar mês" (fechar-mes-btn) — só confirmar que existe pro DIRECTOR.
 *  - NÃO clicar "Marcar pago" (comissao-pagar-{id}) nem confirmar os modais
 *    (fechar-mes-confirm / pagar-confirm). Este spec é só visualização + filtros.
 */

/** Conta linhas da tabela de comissões (Table.tsx usa data-testid="data-row"). */
function rows(page: Page) {
  return page.locator('[data-testid="data-row"]');
}

/**
 * Espera a lista admin estabilizar num estado terminal após carga/filtro:
 * ou a tabela aparece, ou o estado vazio. (StateView troca loading→tabela|empty.)
 */
async function esperarListaEstavel(page: Page): Promise<void> {
  const tabela = page.getByTestId('data-table');
  const vazio = page.getByTestId('state-empty');
  await expect(async () => {
    const temTabela = await tabela.isVisible().catch(() => false);
    const temVazio = await vazio.isVisible().catch(() => false);
    expect(temTabela || temVazio).toBe(true);
  }).toPass({ timeout: 15_000 });
}

test.describe('Comissões @regression', () => {
  test('DIRECTOR vê a lista/tabela da equipe sem NaN', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/comissoes');
    await shot(page, 'comissoes-lista-inicio');

    // Cabeçalho da página. Usamos o testid do PageLayout (<h1 page-title>) porque
    // getByRole('heading', { name: 'Comissões' }) colide com o <h2>"Comissões da
    // equipe"> do bloco admin (strict mode violation: 2 headings).
    await expect(page.getByTestId('page-title')).toHaveText('Comissões', { timeout: 15_000 });
    // Bloco admin presente (DIRECTOR tem comissoes.all).
    await expect(page.getByText('Comissões da equipe')).toBeVisible({ timeout: 15_000 });

    // A lista chega a um estado terminal: tabela OU estado vazio. No período atual
    // (mês corrente) pode legitimamente NÃO haver comissões → empty state
    // "Nenhuma comissão encontrada nesse filtro." NÃO exigimos a tabela existir;
    // basta um dos dois sinais terminais (sem ficar em loading).
    await esperarListaEstavel(page);
    const temTabela = await page.getByTestId('data-table').isVisible().catch(() => false);
    const temVazio = await page.getByTestId('state-empty').isVisible().catch(() => false);
    expect(temTabela || temVazio, 'esperava tabela OU estado vazio').toBe(true);
    await shot(page, 'comissoes-lista-meio');

    // ── BUG-HUNT (asserção dura, mantida): valores em R$/% nunca renderizam
    // "NaN"/"Invalid Date"/"undefined" — vale tanto pra tabela quanto pro vazio. ──
    await expect(
      page.locator('body'),
      'valores de comissão (R$/%) não deveriam conter NaN',
    ).not.toContainText('NaN');
    await expect(page.locator('body')).not.toContainText('Invalid Date');
    await expect(page.locator('body')).not.toContainText('undefined');

    await shot(page, 'comissoes-lista-fim');
  });

  test('fechar-mes-btn existe pro DIRECTOR (sem clicar)', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/comissoes');
    await shot(page, 'comissoes-fecharbtn-inicio');

    await expect(page.getByText('Comissões da equipe')).toBeVisible({ timeout: 15_000 });

    // Só CONFIRMAR a presença do botão (DIRECTOR é canManage). NÃO clicar —
    // "Fechar mês" é ação financeira (agrega pedidos e cria registros REP/GERENTE).
    await expect(page.getByTestId('fechar-mes-btn')).toBeVisible({ timeout: 15_000 });

    // Garantia extra: o modal de fechamento NÃO está aberto (não disparamos a ação).
    await expect(page.getByTestId('fechar-mes-confirm')).toHaveCount(0);
    await shot(page, 'comissoes-fecharbtn-fim');
  });

  test('filtros (mês/ano/pago) mudam a lista sem quebrar', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/comissoes');
    await shot(page, 'comissoes-filtros-inicio');

    await expect(page.getByText('Comissões da equipe')).toBeVisible({ timeout: 15_000 });
    await esperarListaEstavel(page);

    // Filtro MÊS → escolhe "Todos meses" (value="") pra ampliar e garantir reação.
    await page.getByTestId('filter-mes').selectOption('');
    await esperarListaEstavel(page);
    await expect(page.locator('body')).not.toContainText('NaN');
    await shot(page, 'comissoes-filtros-mes');

    // Filtro ANO → escolhe um ano qualquer das opções (ano-1). A lista recarrega
    // (listPath muda → useApiQuery refaz). Resiliente a vazio.
    const anoSelect = page.getByTestId('filter-ano');
    const anoOpcao = anoSelect.locator('option').first(); // ano-1
    const anoVal = (await anoOpcao.getAttribute('value')) ?? '';
    if (anoVal) await anoSelect.selectOption(anoVal);
    await esperarListaEstavel(page);
    await expect(page.locator('body')).not.toContainText('NaN');
    await shot(page, 'comissoes-filtros-ano');

    // Filtro PAGO → "Apenas pagos" (true) e depois "Apenas em aberto" (false).
    // Cada troca recarrega a lista; checamos que não quebra e que é terminal.
    await page.getByTestId('filter-pago').selectOption('true');
    await esperarListaEstavel(page);
    await expect(page.locator('body')).not.toContainText('NaN');

    await page.getByTestId('filter-pago').selectOption('false');
    await esperarListaEstavel(page);
    await expect(page.locator('body')).not.toContainText('NaN');

    // Sanidade do filtro "Apenas em aberto": se há linhas, NENHUMA pode estar "Pago".
    // (Resiliente: se o estado for vazio, simplesmente não há o que checar.)
    const temLinhas = (await rows(page).count()) > 0;
    if (temLinhas) {
      await expect(
        page.getByTestId('data-table').getByText('Pago', { exact: true }),
      ).toHaveCount(0);
    }
    await shot(page, 'comissoes-filtros-fim');
  });
});
