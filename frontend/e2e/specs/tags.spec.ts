import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Tags — CRUD + listagem (Fase 2, roteiro por área).
 *
 * Padrão herdado de clientes.spec.ts: login pela UI (diretorA = DIRECTOR da empresa A,
 * tem canEdit), navega pra /tags e exercita o fluxo real contra frontend(5174)+backend(4001).
 *
 * Seletores reais (lidos de TagsPage.tsx + Modal + useConfirm):
 *  - Abrir form novo ......... testid `tag-new`            (só aparece pra ADMIN/DIRECTOR/GERENTE)
 *  - Modal (criar/editar) .... testid `modal-overlay` + `modal-content`
 *  - Nome .................... testid `tag-nome`           (Input dentro do FormField "Nome")
 *  - Cor (hex livre) ......... testid `tag-cor-hex`        (Input texto, normaliza no blur)
 *  - Cor (preset) ............ testid `tag-color-{hex}`    (ex: `tag-color-#2563eb`)
 *  - Salvar .................. testid `tag-save`           (disabled enquanto nome vazio)
 *  - Card da tag ............. testid `tag-card-{id}`      (grid; NÃO há linha de tabela)
 *  - Editar / Excluir card ... testid `tag-edit-{id}` / `tag-del-{id}`
 *  - Confirmação de exclusão . testid `confirm-ok`        (Dialog do useConfirm; cancelar sem testid)
 *  - Toast ................... testid `toast-success` / `toast-error`
 *  - Busca ................... placeholder "Buscar tag…"
 *  - Vazio ................... StateView empty ("Nenhuma tag encontrada…")
 *
 * Observações de implementação:
 *  - NÃO existe `tag-row-*`; o id da tag criada é descoberto localizando o card
 *    (`tag-card-*`) que contém o nome único e extraindo o sufixo do data-testid.
 *  - O Modal de criação e o Dialog de confirmação compartilham o testid
 *    `modal-overlay`. Nos fluxos abaixo eles nunca ficam abertos ao mesmo tempo,
 *    e mesmo assim a confirmação é acionada pelo testid específico `confirm-ok`
 *    (não pelo overlay), evitando qualquer ambiguidade.
 */

const SEARCH_PLACEHOLDER = 'Buscar tag…';
/** Uma cor preset qualquer da paleta PRESET_COLORS (azul). */
const COR_HEX = '#2563eb';

/** Todos os cards de tag renderizados (cada um tem testid tag-card-*). */
function cards(page: Page) {
  return page.locator('[data-testid^="tag-card-"]');
}

/** Localiza o card cujo conteúdo casa o nome único informado. */
function cardByName(page: Page, nome: string) {
  return cards(page).filter({ hasText: nome });
}

/**
 * Cria uma tag do zero pela UI e devolve { nome, id }.
 * Pressupõe estar em /tags. Confirma sucesso pelo card aparecer (busca pelo nome)
 * OU pelo toast-success — aceita qualquer um dos sinais (resiliente).
 */
async function criarTag(page: Page): Promise<{ nome: string; id: string }> {
  const nome = `Tag E2E ${Date.now()}`;

  // diretorA tem canEdit ⇒ o botão "Nova tag" existe.
  await expect(page.getByTestId('tag-new')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tag-new').click();

  // Modal de criação abre.
  await expect(page.getByTestId('modal-overlay')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tag-nome').fill(nome);
  // Escolhe a cor por hex livre (campo `tag-cor-hex`). O onBlur normaliza
  // (#RRGGBB lowercase) — COR_HEX já está nesse formato, então fica estável.
  const corInput = page.getByTestId('tag-cor-hex');
  await corInput.fill(COR_HEX);
  await corInput.blur();

  // Salvar (habilita assim que há nome).
  await expect(page.getByTestId('tag-save')).toBeEnabled();
  await page.getByTestId('tag-save').click();

  // Sucesso: o modal fecha (onSaved → refetch) OU toast-success aparece.
  const toast = page.getByTestId('toast-success');
  await Promise.race([
    toast.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
    page.getByTestId('modal-overlay').waitFor({ state: 'hidden', timeout: 15_000 }),
  ]);

  // Verificação dura: a tag existe na listagem. Busca pelo nome único pra isolar.
  await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill(nome);
  const card = cardByName(page, nome).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const testid = (await card.getAttribute('data-testid')) ?? '';
  const id = testid.replace('tag-card-', '');
  return { nome, id };
}

// ─────────────────────────────────────────────────────────────────────────
test.describe('Tags @regression', () => {
  test('lista carrega sem NaN/undefined', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/tags');
    await shot(page, 'tags-lista-inicio');

    // A página renderiza: ou aparece o botão de nova tag (canEdit), ou ao menos
    // o container do card/estado. Espera o título "Tags" pra garantir que montou.
    await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible({ timeout: 15_000 });
    await shot(page, 'tags-lista-meio');

    // Bug-guard (risco citado no roteiro): a lista/contadores não podem exibir
    // "NaN" nem "undefined" em lugar nenhum do conteúdo da página. Cada card
    // mostra "{n} clientes" — se clientesCount vier quebrado, apareceria "NaN".
    const corpo = await page.locator('main, body').first().innerText();
    expect(corpo).not.toMatch(/\bNaN\b/);
    expect(corpo).not.toMatch(/\bundefined\b/);
    await shot(page, 'tags-lista-fim');
  });

  test('criar tag aparece na lista', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/tags');
    await shot(page, 'tags-criar-inicio');

    await shot(page, 'tags-criar-meio');
    const { nome } = await criarTag(page);

    // Confirma o nome único visível no card.
    await expect(page.getByText(nome, { exact: false }).first()).toBeVisible();
    await shot(page, 'tags-criar-fim');
  });

  test('excluir tag com confirmação some da lista', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/tags');
    await shot(page, 'tags-excluir-inicio');

    // Cria uma tag própria pra excluir (isolada de outros testes/re-runs).
    const { nome, id } = await criarTag(page);

    // Garante que a busca está filtrada nessa tag e o card existe.
    await expect(page.getByTestId(`tag-card-${id}`)).toBeVisible({ timeout: 15_000 });
    await shot(page, 'tags-excluir-meio');

    // Excluir: botão `tag-del-{id}` no card → Dialog de confirmação (`confirm-ok`).
    await page.getByTestId(`tag-del-${id}`).click();
    const confirmar = page.getByTestId('confirm-ok');
    await expect(confirmar).toBeVisible({ timeout: 15_000 });
    await confirmar.click();

    // Sucesso: toast "Tag excluída" e o card some (refetch). Aceita ambos os sinais,
    // mas a verificação dura é o card desaparecer da lista filtrada pelo nome.
    await page.getByTestId('toast-success').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill(nome);
    await expect(async () => {
      const n = await cardByName(page, nome).count();
      expect(n).toBe(0);
    }).toPass({ timeout: 15_000 });
    await shot(page, 'tags-excluir-fim');
  });
});
