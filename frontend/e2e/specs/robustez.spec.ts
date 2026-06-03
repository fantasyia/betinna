import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Robustez — CAMADA 3 (transversal de UX/qualidade). Login: diretorA.
 *
 * Cobre quatro garantias que cortam várias telas:
 *  1. Modo escuro alterna e aplica `class="dark"` no <html> (dashboard, clientes, pedidos).
 *  2. Popup fecha SÓ no X — clique-fora (no overlay) NÃO fecha (Lote 1 fixou isso).
 *  3. Confirmação destrutiva: excluir cliente pede confirm e dá pra CANCELAR sem apagar.
 *  4. Formatos pt-BR (i18n): dinheiro em R$ (1.234,56) e datas dd/mm/aaaa.
 *
 * Tudo contra o app local (frontend 5174 + backend 4001) via playwright.local.config.ts.
 *
 * ── Seletores reais (lidos do código, NÃO assumidos) ──────────────────────
 *
 *  TEMA (PageLayout.tsx → ThemeToggle, usa hook useTheme):
 *    O botão de tema NÃO tem data-testid. É um <button> com aria-label dinâmico:
 *      - tema atual claro → aria-label "Trocar para dark mode"  (ícone lua)
 *      - tema atual escuro → aria-label "Trocar para light mode" (ícone sol)
 *    Mora no header da sidebar (componente SidebarLogo). useTheme adiciona/remove
 *    a classe `dark` em document.documentElement (<html>) e persiste em
 *    localStorage('betinna-theme'). ⇒ seletor:
 *      page.getByTestId('sidebar').getByRole('button', { name: /Trocar para (dark|light) mode/i })
 *    (O palpite /tema|escuro|claro|theme/i do enunciado NÃO casaria — o texto real
 *     é "Trocar para dark/light mode".)
 *
 *  MODAL do cliente (ClientesPage.tsx → ClienteFormModal usa <Dialog> de ui/Dialog.tsx):
 *    - Overlay ........... testid `modal-overlay` (a div externa, backdrop)
 *    - Conteúdo .......... NÃO tem testid `modal-content`; o painel interno é role="dialog"
 *                          ⇒ usamos page.getByRole('dialog')
 *    - Fechar (X) ........ NÃO tem testid `modal-close`; é IconButton aria-label "Fechar"
 *                          ⇒ page.getByRole('button', { name: 'Fechar' })
 *    - Backdrop click .... Dialog só fecha no backdrop se closeOnBackdrop={true};
 *                          o form de cliente NÃO passa essa prop ⇒ clique-fora NÃO fecha.
 *
 *  EXCLUIR cliente (ClienteDetailPage.tsx, aba Dados):
 *    - `cliente-del` → revela "Cancelar" (sem testid) + `cliente-del-confirm`.
 *      "Cancelar" volta ao estado inicial (mostra `cliente-del` de novo) sem apagar.
 *
 *  i18n (PedidosPage.tsx): cada linha da lista renderiza fmtBRL(total) via
 *    Intl.NumberFormat('pt-BR', currency BRL) → "R$ 1.234,56" e fmtDate(criadoEm)
 *    via toLocaleDateString('pt-BR') → "dd/mm/aaaa".
 */

const SEARCH_PLACEHOLDER = 'Buscar por nome, CNPJ, e-mail…';

// Regex pt-BR pedidos pelo enunciado.
const RE_BRL = /R\$\s?\d{1,3}(\.\d{3})*,\d{2}/; // R$ 1.234,56 / R$ 99,90 (\s casa o nbsp do Intl)
const RE_DATE = /\d{2}\/\d{2}\/\d{4}/; //          31/12/2026

/** Localiza o botão de alternância de tema (sem testid próprio). */
function themeToggle(page: Page) {
  return page
    .getByTestId('sidebar')
    .getByRole('button', { name: /Trocar para (dark|light) mode/i });
}

/**
 * Garante o tema ESCURO: se o <html> ainda não tem `dark`, clica o toggle.
 * Idempotente — não depende do estado inicial (que respeita prefers-color-scheme).
 */
async function ensureDark(page: Page) {
  const html = page.locator('html');
  if (!(await html.evaluate((el) => el.classList.contains('dark')))) {
    await themeToggle(page).click();
  }
  await expect(html).toHaveClass(/dark/);
}

/** Garante o tema CLARO: se o <html> tem `dark`, clica o toggle pra remover. */
async function ensureLight(page: Page) {
  const html = page.locator('html');
  if (await html.evaluate((el) => el.classList.contains('dark'))) {
    await themeToggle(page).click();
  }
  await expect(html).not.toHaveClass(/dark/);
}

/** Conta linhas da tabela de clientes (cada linha tem testid cliente-row-*). */
function clienteRows(page: Page) {
  return page.locator('[data-testid^="cliente-row-"]');
}

/**
 * Gera um CNPJ válido (DV correto) e único por timestamp — mesma fórmula do
 * isValidCNPJ do front (não bloqueia no DV e evita colisão de UNIQUE no backend).
 */
function cnpjValidoUnico(): string {
  const base = String(Date.now()).slice(-12).padStart(12, '0').split('').map(Number);
  const dv = (nums: number[]): number => {
    let pos = nums.length - 7;
    let sum = 0;
    for (let i = 0; i < nums.length; i++) {
      sum += nums[i] * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  const full = [...base, d1, d2].join('');
  return `${full.slice(0, 2)}.${full.slice(2, 5)}.${full.slice(5, 8)}/${full.slice(8, 12)}-${full.slice(12)}`;
}

/**
 * Cria um cliente do zero (escopando o form ao modal-overlay) e retorna { nome, id }.
 * Reaproveita os mesmos seletores reais do clientes.spec. Pressupõe estar em /clientes.
 */
async function criarCliente(page: Page): Promise<{ nome: string; id: string }> {
  const nome = `Cliente E2E ${Date.now()}`;
  await page.getByTestId('cliente-new-btn').click();
  const modal = page.getByTestId('modal-overlay');
  await expect(modal).toBeVisible();

  await modal.getByTestId('cliente-nome-input').fill(nome);
  await modal.getByTestId('cliente-cnpj-input').fill(cnpjValidoUnico());
  await modal.getByLabel('Segmento').fill('E2E Robustez');
  await modal.getByLabel('E-mail').fill(`e2e_${Date.now()}@betinna.test`);
  await modal.getByLabel('Telefone').fill('11999998888');
  await modal.getByLabel('CEP').fill('01310100');
  await modal.getByLabel('Logradouro').fill('Av. Paulista');
  await modal.getByTestId('cliente-numero-input').fill('1000');
  await modal.getByLabel('Bairro').fill('Bela Vista');
  await modal.getByTestId('cliente-uf-select').selectOption('SP');

  const cidadeSelect = modal.getByTestId('cliente-cidade-select');
  await expect(cidadeSelect.locator('option', { hasText: 'São Paulo' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await cidadeSelect.selectOption({ label: 'São Paulo' });

  await modal.getByTestId('cliente-save-btn').click();
  await expect(modal).toBeHidden({ timeout: 15_000 });

  const buscar = page.getByPlaceholder(SEARCH_PLACEHOLDER);
  await buscar.fill(nome);
  const row = clienteRows(page).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const id = ((await row.getAttribute('data-testid')) ?? '').replace('cliente-row-', '');
  return { nome, id };
}

// ─────────────────────────────────────────────────────────────────────────
test.describe('Robustez @regression', () => {
  test('modo escuro alterna e aplica class dark no html (dashboard, clientes, pedidos)', async ({
    page,
  }) => {
    await loginViaUI(page, USERS.diretorA.email);

    // ── /dashboard ──
    await page.goto('/dashboard');
    await shot(page, 'robustez-dark-inicio');
    // O toggle deve existir (sem testid → via aria-label real, não o palpite do enunciado).
    await expect(themeToggle(page)).toBeVisible({ timeout: 15_000 });

    await ensureDark(page);
    // Garantia dura pedida no enunciado.
    await expect(page.locator('html')).toHaveClass(/dark/);
    await shot(page, 'robustez-dark-dashboard');

    // ── /clientes (o tema persiste via localStorage; reconfirmamos após navegar) ──
    await page.goto('/clientes');
    await ensureDark(page);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await shot(page, 'robustez-dark-clientes');

    // ── /pedidos ──
    await page.goto('/pedidos');
    await ensureDark(page);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await shot(page, 'robustez-dark-pedidos');

    // Volta pro claro no fim e confirma que a classe saiu.
    await ensureLight(page);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await shot(page, 'robustez-dark-fim');
  });

  test('popup fecha só no X — clique fora (overlay) não fecha', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/clientes');
    await shot(page, 'robustez-modalx-inicio');

    // Abre o form de novo cliente.
    await expect(page.getByTestId('cliente-new-btn')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('cliente-new-btn').click();

    const overlay = page.getByTestId('modal-overlay');
    // O painel interno é role="dialog" (Dialog.tsx NÃO expõe testid `modal-content`).
    const content = page.getByRole('dialog');
    await expect(overlay).toBeVisible();
    await expect(content).toBeVisible();

    // Clica na ÁREA do overlay FORA do conteúdo (canto superior-esquerdo, longe do painel
    // que é centralizado). force:true porque o overlay é "presentation" e o hit-test
    // pode mirar um filho; a coordenada {5,5} cai no backdrop.
    await overlay.click({ position: { x: 5, y: 5 }, force: true });

    // BUG-GUARD: o modal deve CONTINUAR aberto (Dialog do cliente não passa
    // closeOnBackdrop ⇒ clique-fora é no-op). Se fechar aqui, é regressão do Lote 1.
    await expect(content, 'modal NÃO deveria fechar no clique-fora (Lote 1)').toBeVisible();
    await expect(overlay).toBeVisible();
    await shot(page, 'robustez-modalx-apos-clique-fora');

    // Agora fecha pelo X. Não há testid `modal-close`; o botão é IconButton aria-label "Fechar".
    await page.getByRole('button', { name: 'Fechar' }).click();
    await expect(overlay).toBeHidden({ timeout: 15_000 });
    await expect(content).toBeHidden();
    await shot(page, 'robustez-modalx-fim');
  });

  test('confirmação destrutiva: excluir cliente abre confirm e dá pra cancelar sem apagar', async ({
    page,
  }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/clientes');
    await shot(page, 'robustez-confirm-inicio');

    // Cria um cliente próprio (isolado) e abre a página /clientes/:id (aba Dados).
    const { id } = await criarCliente(page);
    await page.getByTestId(`cliente-open-${id}`).click();
    await expect(page).toHaveURL(new RegExp(`/clientes/${id}`), { timeout: 15_000 });

    // Estado inicial: botão de excluir visível, confirm AINDA não.
    const excluir = page.getByTestId('cliente-del');
    await expect(excluir).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('cliente-del-confirm')).toHaveCount(0);

    // Clica excluir → o confirm aparece ANTES de apagar (não some da lista ainda).
    await excluir.click();
    const confirmar = page.getByTestId('cliente-del-confirm');
    await expect(confirmar).toBeVisible();
    await shot(page, 'robustez-confirm-aberto');

    // CANCELA sem excluir. O "Cancelar" é o único botão visível com esse nome neste
    // estado (os Modais que também têm "Cancelar" estão fechados/desmontados).
    await page.getByRole('button', { name: 'Cancelar' }).click();

    // Voltou ao estado inicial: confirm sumiu, botão de excluir reapareceu,
    // e seguimos na MESMA página (cliente não foi apagado).
    await expect(page.getByTestId('cliente-del-confirm')).toHaveCount(0);
    await expect(excluir).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/clientes/${id}`));
    await shot(page, 'robustez-confirm-fim');
  });

  test('formatos pt-BR (i18n): dinheiro em R$ e datas dd/mm/aaaa', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);

    // Telas candidatas, em ordem: pedidos (lista tem R$ + data por linha),
    // depois relatórios e comissões como fallback resiliente a dados.
    const candidatas = ['/pedidos', '/relatorios', '/comissoes'];

    let achouMoeda = false;
    let achouData = false;
    let onde = '';

    for (const rota of candidatas) {
      await page.goto(rota);
      // Deixa a tela assentar (queries async). networkidle é suficiente aqui.
      await page.waitForLoadState('networkidle').catch(() => undefined);
      if (rota === '/pedidos') await shot(page, 'robustez-i18n-pedidos');

      // Lê o texto renderizado da página inteira (body) — pega valores de qualquer
      // célula/cartão sem depender de testid de linha específico.
      const texto = (await page.locator('body').innerText()) ?? '';
      achouMoeda = RE_BRL.test(texto);
      achouData = RE_DATE.test(texto);
      onde = rota;
      if (achouMoeda && achouData) break;
    }

    await shot(page, `robustez-i18n-${onde.replace('/', '') || 'final'}`);

    // BUG-GUARD: se o app mostrasse "$ 1,234.56" (formato US) ou ponto decimal,
    // o RE_BRL falharia aqui e o teste apontaria o bug de i18n.
    expect(
      achouMoeda,
      `nenhum valor em R$ no formato pt-BR (1.234,56) encontrado em ${candidatas.join(', ')}`,
    ).toBe(true);
    expect(
      achouData,
      `nenhuma data dd/mm/aaaa encontrada em ${candidatas.join(', ')}`,
    ).toBe(true);
  });
});
