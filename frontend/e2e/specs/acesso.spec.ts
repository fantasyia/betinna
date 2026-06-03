import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Acesso — Multi-tenant + Permissões por papel + Visibilidade de carteira (Fase 2).
 *
 * Prova que o isolamento por empresa (tenant), o gate de permissões (ProtectedRoute → /403)
 * e o filtro automático de carteira do REP funcionam de ponta a ponta
 * (Playwright → frontend 5174 → backend 4001 → banco semeado).
 *
 * Seletores reais (lidos de ClientesPage.tsx, EmpresaSwitcher.tsx, ProtectedRoute.tsx,
 * ForbiddenPage.tsx, App.tsx, usePermission.ts):
 *  - Linha de cliente .......... testid `cliente-row-{id}` (contagem via prefixo)
 *  - Busca de clientes ......... placeholder "Buscar por nome, CNPJ, e-mail…"
 *  - Empresa switcher (2+) ..... testid `empresa-switcher` + opções `empresa-switcher-opt-{id}`
 *  - Empresa switcher (1) ...... testid `empresa-switcher-single`
 *  - Lista vazia ............... EmptyState com texto "Nenhum cliente encontrado"
 *  - Página 403 ................ testid `forbidden-page` (ProtectedRoute → /403)
 *
 * Dados semeados (seed-test.ts):
 *  - Empresa A "Alfa Alimentos": 14 clientes. Empresa B "Beta Bebidas": 6 clientes.
 *  - ADMIN pertence a A+B (vê o dropdown de troca de empresa).
 *  - "Bar do Zé" é cliente da empresa B (não existe em A).
 *  - Carteira repA1 (repsA[i] = repA1 nos índices 0,3,6,8,11,13):
 *      "Mercado Bom Preço", "Atacadão do Bairro", "Super Econômico",
 *      "Mercado Estrela", "Padaria Pão Quente", "Atacado Mais"  → 6 clientes
 *  - Carteira repA2 (índices 1,4,7,9,12):
 *      "Distribuidora Central", "Mercearia da Esquina", "Comercial Aliança",
 *      "Distribuidora Sul", "Mercado Popular"  → 5 clientes
 *  - Clientes catch-all (rep null, índices 2,5,10): visíveis pra diretor/gerente,
 *      NÃO pro rep ("Supermercado Família", "Empório São José", "Hortifruti Verde").
 */

const SEARCH_PLACEHOLDER = 'Buscar por nome, CNPJ, e-mail…';

// Cliente exclusivo da empresa B — não existe na A (bom marcador cross-tenant).
const CLIENTE_B = 'Bar do Zé';
// Cliente da carteira do repA1 (aparece pro repA1).
const CLIENTE_REP_A1 = 'Mercado Bom Preço';
// Cliente da carteira do repA2 (NÃO aparece pro repA1).
const CLIENTE_REP_A2 = 'Distribuidora Central';
// Cliente catch-all (rep null) — visível pro diretor, NÃO pro rep.
const CLIENTE_CATCHALL = 'Supermercado Família';

/** Conta linhas da tabela de clientes (cada linha tem testid cliente-row-*). */
function rows(page: Page) {
  return page.locator('[data-testid^="cliente-row-"]');
}

/** Vai pra /clientes e espera o primeiro estado estável (linhas OU empty state). */
async function irParaClientes(page: Page): Promise<void> {
  await page.goto('/clientes');
  await expect(page).toHaveURL(/\/clientes/, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  // Espera sair do loading skeleton: aparece uma linha OU a mensagem de vazio.
  await expect(async () => {
    const n = await rows(page).count();
    const vazio = await page.getByText(/Nenhum cliente/i).isVisible().catch(() => false);
    expect(n > 0 || vazio).toBeTruthy();
  }).toPass({ timeout: 20_000 });
}

/**
 * Busca por um termo e devolve a contagem de linhas resultante (resiliente:
 * espera o debounce/refetch estabilizar antes de contar).
 */
async function buscarEcontar(page: Page, termo: string): Promise<number> {
  const buscar = page.getByPlaceholder(SEARCH_PLACEHOLDER);
  await buscar.fill(termo);
  // Deixa a query refazer (search dispara refetch via listPath).
  await page.waitForLoadState('networkidle');
  let n = 0;
  await expect(async () => {
    n = await rows(page).count();
    const vazio = await page.getByText(/Nenhum cliente/i).isVisible().catch(() => false);
    // Estado estável: ou achou linhas, ou mostrou o empty state amigável.
    expect(n > 0 || vazio).toBeTruthy();
  }).toPass({ timeout: 15_000 });
  return n;
}

// ─────────────────────────────────────────────────────────────────────────
test.describe('Multi-tenant @smoke', () => {
  test('ADMIN troca de empresa e a lista de clientes muda', async ({ page }) => {
    await loginViaUI(page, USERS.admin.email);
    await irParaClientes(page);
    await shot(page, 'acesso-multitenant-inicio');

    // Empresa ativa atual: conta os clientes.
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    const totalEmpresa1 = await rows(page).count();
    expect(totalEmpresa1).toBeGreaterThan(0);

    // ADMIN pertence a A+B ⇒ o switcher de empresa (dropdown) deve existir.
    const switcher = page.getByTestId('empresa-switcher');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    // Abre o dropdown e lista as opções de empresa (testid empresa-switcher-opt-*).
    await switcher.getByRole('button').first().click();
    const opcoes = page.locator('[data-testid^="empresa-switcher-opt-"]');
    await expect(async () => {
      expect(await opcoes.count()).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 15_000 });

    // Descobre a empresa ATIVA (aria-selected=true) e escolhe uma DIFERENTE.
    const total = await opcoes.count();
    let alvo = -1;
    for (let i = 0; i < total; i++) {
      const selecionada = await opcoes.nth(i).getAttribute('aria-selected');
      if (selecionada !== 'true') {
        alvo = i;
        break;
      }
    }
    expect(alvo, 'não achei uma empresa diferente da ativa pra trocar').toBeGreaterThanOrEqual(0);
    await shot(page, 'acesso-multitenant-dropdown');

    // Trocar de empresa dispara window.location.reload() (auth-store.switchEmpresaAtiva).
    await Promise.all([
      page.waitForLoadState('load'),
      opcoes.nth(alvo).click(),
    ]);

    // Volta pra /clientes (o reload pode cair na rota atual; garantimos /clientes).
    await irParaClientes(page);

    // A lista da outra empresa tem contagem diferente (ex.: 14 vs 6).
    let totalEmpresa2 = 0;
    await expect(async () => {
      totalEmpresa2 = await rows(page).count();
      expect(totalEmpresa2).toBeGreaterThan(0);
      expect(totalEmpresa2).not.toBe(totalEmpresa1);
    }).toPass({ timeout: 20_000 });
    await shot(page, 'acesso-multitenant-trocou');

    // Confirma por dado concreto: "Bar do Zé" (cliente de B) aparece quando B está ativa.
    // Pode estar ativa em qualquer uma das duas trocas — checamos os dois sentidos.
    const achouBarEmpresa2 = (await buscarEcontar(page, CLIENTE_B)) > 0;
    if (achouBarEmpresa2) {
      // Empresa ativa agora é B: o marcador de B existe.
      await expect(page.getByText(CLIENTE_B, { exact: false }).first()).toBeVisible({
        timeout: 15_000,
      });
    } else {
      // Empresa ativa agora é A: "Bar do Zé" NÃO existe em A (isolamento) —
      // então B era a empresa inicial. Provamos o isolamento na rodada atual...
      await expect(page.getByText(/Nenhum cliente/i)).toBeVisible({ timeout: 15_000 });
      // ...e que um cliente típico de A aparece (lista não-vazia ao limpar a busca).
      await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill('');
      await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    }
    await shot(page, 'acesso-multitenant-fim');
  });

  test('isolamento cross-tenant: diretorA não vê cliente da empresa B', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await irParaClientes(page);
    await shot(page, 'acesso-isolamento-inicio');

    // diretorA vê os clientes da empresa A (lista não-vazia).
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    const totalA = await rows(page).count();
    expect(totalA).toBeGreaterThan(0);

    // Busca por "Bar do Zé" (cliente exclusivo de B) → NÃO aparece (isolamento).
    const achados = await buscarEcontar(page, CLIENTE_B);
    expect(achados).toBe(0);
    await expect(page.getByText(/Nenhum cliente/i)).toBeVisible({ timeout: 15_000 });
    await shot(page, 'acesso-isolamento-vazio');

    // Confirma que vê clientes de A: ao limpar a busca, a lista volta com linhas.
    await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill('');
    await expect(async () => {
      expect(await rows(page).count()).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });
    await shot(page, 'acesso-isolamento-fim');
  });
});

// ─────────────────────────────────────────────────────────────────────────
test.describe('Permissões por papel @smoke', () => {
  test('REP sem permissão de admin cai em /403', async ({ page }) => {
    await loginViaUI(page, USERS.repA1.email);
    await shot(page, 'acesso-perm-rep-inicio');

    // /admin exige permissão admin.panel — REP não tem ⇒ ProtectedRoute → /403.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/403/, { timeout: 15_000 });
    await expect(page.getByTestId('forbidden-page')).toBeVisible({ timeout: 15_000 });
    await shot(page, 'acesso-perm-rep-403');

    // Sanidade: o REP TEM clientes.view, então /clientes carrega (não cai em /403).
    await page.goto('/clientes');
    await expect(page).toHaveURL(/\/clientes/, { timeout: 15_000 });
    await expect(page.getByTestId('forbidden-page')).toHaveCount(0);
    await shot(page, 'acesso-perm-rep-fim');
  });

  test('DIRECTOR acessa /relatorios sem cair em /403', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await shot(page, 'acesso-perm-diretor-inicio');

    // /relatorios exige relatorios.view — DIRECTOR tem ⇒ carrega normalmente.
    await page.goto('/relatorios');
    await expect(page).toHaveURL(/\/relatorios/, { timeout: 15_000 });
    await expect(page.getByTestId('forbidden-page')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await shot(page, 'acesso-perm-diretor-fim');
  });
});

// ─────────────────────────────────────────────────────────────────────────
test.describe('Visibilidade de carteira @smoke', () => {
  test('REP vê só a própria carteira (menos que o diretor)', async ({ page }) => {
    // 1) Diretor enxerga TODA a empresa A (carteiras + catch-all).
    await loginViaUI(page, USERS.diretorA.email);
    await irParaClientes(page);
    await shot(page, 'acesso-carteira-diretor');
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    const totalDiretor = await rows(page).count();
    expect(totalDiretor).toBeGreaterThan(0);

    // Diretor vê um cliente catch-all (rep null) — referência pra comparar com o rep.
    const catchallDiretor = await buscarEcontar(page, CLIENTE_CATCHALL);
    expect(catchallDiretor).toBeGreaterThan(0);

    // 2) Logout e entra como repA1.
    await page.goto('/login'); // garante saída da sessão anterior antes do novo login
    await loginViaUI(page, USERS.repA1.email);
    await irParaClientes(page);
    await shot(page, 'acesso-carteira-rep-inicio');

    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    const totalRep = await rows(page).count();
    expect(totalRep).toBeGreaterThan(0);

    // O rep vê MENOS que o diretor (filtro automático de carteira).
    expect(totalRep).toBeLessThan(totalDiretor);

    // Um cliente da carteira do repA1 APARECE.
    const achouProprio = await buscarEcontar(page, CLIENTE_REP_A1);
    expect(achouProprio).toBeGreaterThan(0);
    await expect(page.getByText(CLIENTE_REP_A1, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
    await shot(page, 'acesso-carteira-rep-proprio');

    // Um cliente da carteira do repA2 NÃO aparece pro repA1.
    const achouDeOutroRep = await buscarEcontar(page, CLIENTE_REP_A2);
    expect(achouDeOutroRep).toBe(0);

    // E um cliente catch-all (rep null) também NÃO aparece pro rep.
    const achouCatchall = await buscarEcontar(page, CLIENTE_CATCHALL);
    expect(achouCatchall).toBe(0);
    await expect(page.getByText(/Nenhum cliente/i)).toBeVisible({ timeout: 15_000 });
    await shot(page, 'acesso-carteira-rep-fim');
  });
});
