import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Campanhas — criação + listagem + filtros + guarda de métricas (Fase 2).
 *
 * Padrão herdado de clientes.spec.ts: login pela UI (diretorA = DIRECTOR da empresa A,
 * tem campanhas.create/edit e canManage), navega pra /campanhas e exercita o fluxo
 * real contra frontend(5174)+backend(4001).
 *
 * Seletores reais (lidos de CampanhasPage.tsx + Table + Modal):
 *  - Abrir form novo ......... testid `campanha-new`
 *  - Modal criar ............. testid `modal-overlay` + `modal-content` (título "Nova campanha")
 *  - Nome .................... testid `campanha-nome`
 *  - Canal ................... <select id="c-canal"> (sem testid; getByLabel('Canal'))
 *  - Mensagem WhatsApp ....... <textarea id="c-wa"> (OBRIGATÓRIA p/ canal WHATSAPP; getByLabel)
 *  - Destinatários (tags) .... container `campanha-tags`; pílulas `tag-pill-{id}`
 *  - Disparar agora (radio) .. testid `campanha-agora`   (default; mantém RASCUNHO)
 *  - Agendar (radio) ......... testid `campanha-agendar` + data `campanha-data` (datetime-local)
 *  - Salvar .................. testid `campanha-save`     ("Criar (rascunho)" / "Agendar")
 *  - Lista (tabela) .......... linhas `data-row`; abrir item `campanha-open-{id}`
 *  - Disparar (NÃO clicar) ... `campanha-disparar-{id}` (linha) / `campanha-disparar` (modal detalhe)
 *  - Filtros ................. testid `filter-status` / `filter-canal`
 *  - Resumo (StatBox) ........ grid de cards no topo (Total/Rascunhos/…/Alcance 30d)
 *  - Métricas (modal detalhe)  Stat "Taxa envio/leitura/erro" via fmtPct (guard contra NaN)
 *  - Toast ................... testid `toast-success` / `toast-error`
 *
 * Observações importantes:
 *  - O canal default é WHATSAPP ⇒ "Mensagem WhatsApp" é obrigatória (validação
 *    client-side em submit() + required no textarea). Por isso o helper preenche
 *    nome + mensagem WA, conforme o componente exige.
 *  - Ao salvar, onSaved abre o MODAL DE DETALHE da campanha (setSelected). Esse
 *    modal contém `campanha-disparar` — NÃO clicamos; fechamos via `modal-close`.
 *  - Métricas com NaN/undefined são o risco citado no roteiro: além de inspecionar
 *    o resumo da lista, abrimos a aba "Métricas" do detalhe e verificamos que
 *    nenhum valor exibe "NaN" nem "undefined".
 */

/** Linhas da tabela de campanhas (Table.tsx emite data-testid="data-row"). */
function rows(page: Page) {
  return page.locator('[data-testid="data-row"]');
}

/** Texto visível dos cards de resumo (StatBox) no topo da página. */
async function resumoText(page: Page): Promise<string> {
  // O resumo é um grid logo após as abas; cada StatBox tem um rótulo "TOTAL" etc.
  // Pegamos o ancestral que contém "Total" e "Alcance 30d" pra inspecionar tudo.
  const box = page.locator('div', { hasText: 'Alcance 30d' }).last();
  if (await box.count()) return (await box.innerText()).trim();
  return '';
}

/**
 * Cria uma campanha RASCUNHO pela UI e devolve { nome, id }.
 * Pressupõe estar em /campanhas. Preenche TODOS os obrigatórios do canal default
 * (WhatsApp): nome + mensagem WA. Seleciona "disparar agora" (rascunho) e, se houver
 * tags, marca a primeira pílula. NÃO dispara a campanha.
 */
async function criarCampanha(page: Page): Promise<{ nome: string; id: string }> {
  const nome = `Campanha E2E ${Date.now()}`;

  await expect(page.getByTestId('campanha-new')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('campanha-new').click();

  const modal = page.getByTestId('modal-content');
  await expect(modal).toBeVisible({ timeout: 15_000 });

  // Nome (obrigatório).
  await modal.getByTestId('campanha-nome').fill(nome);

  // Canal default = WhatsApp ⇒ mensagem WA é obrigatória. Preenche pelo id do textarea.
  await modal.locator('#c-wa').fill('Olá {nome}, oferta especial pra você! (teste E2E)');

  // Destinatários: se a empresa tiver tags, seleciona a 1ª pílula (segmento).
  // Sem tags, o componente envia pra toda a base — não há pílula pra clicar.
  const pills = modal.locator('[data-testid^="tag-pill-"]');
  if (await pills.count()) {
    await pills.first().click();
  }

  // Quando enviar: "agora" (rascunho). É o default, mas marcamos explicitamente.
  await modal.getByTestId('campanha-agora').check();

  // Salvar (rascunho).
  await modal.getByTestId('campanha-save').click();

  // Sucesso: onSaved fecha o modal de criação e ABRE o modal de detalhe da campanha.
  // O título "Nova campanha" some; o detalhe mostra o nome da campanha. Aceitamos
  // qualquer sinal de sucesso (toast OU troca de modal) e então fechamos o detalhe.
  const toast = page.getByTestId('toast-success');
  await Promise.race([
    toast.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
    modal.getByText('Nova campanha').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined),
    page.getByTestId('campanha-disparar').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
  ]);

  // Fecha o modal de detalhe SEM disparar (botão X = modal-close). Não tocar em
  // `campanha-disparar`.
  const close = page.getByTestId('modal-close');
  if (await close.count()) await close.first().click();
  await expect(page.getByTestId('modal-overlay')).toBeHidden({ timeout: 15_000 });

  // Verificação dura: a campanha aparece na lista. Busca pelo nome único pra isolar.
  await page.getByPlaceholder('Nome da campanha…').fill(nome);
  const openBtn = page.locator('[data-testid^="campanha-open-"]').first();
  await expect(openBtn).toBeVisible({ timeout: 15_000 });
  const testid = (await openBtn.getAttribute('data-testid')) ?? '';
  const id = testid.replace('campanha-open-', '');
  return { nome, id };
}

// ─────────────────────────────────────────────────────────────────────────
test.describe('Campanhas @regression', () => {
  test('página carrega e resumo não tem NaN/undefined', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/campanhas');
    await shot(page, 'campanhas-carrega-inicio');

    await expect(page.getByRole('heading', { name: 'Campanhas' })).toBeVisible({ timeout: 15_000 });
    await shot(page, 'campanhas-carrega-meio');

    // Bug-guard (risco citado no roteiro): o resumo/stats não pode exibir "NaN"
    // nem "undefined". Inspeciona o conteúdo completo da página (cobre tanto os
    // StatBox do topo quanto a tabela).
    const corpo = await page.locator('main, body').first().innerText();
    expect(corpo, 'resumo/lista não deve conter NaN').not.toMatch(/\bNaN\b/);
    expect(corpo, 'resumo/lista não deve conter undefined').not.toMatch(/\bundefined\b/);

    // Reforço focado no resumo (StatBox), se ele renderizou.
    const resumo = await resumoText(page);
    if (resumo) {
      expect(resumo).not.toMatch(/\bNaN\b/);
      expect(resumo).not.toMatch(/\bundefined\b/);
    }
    await shot(page, 'campanhas-carrega-fim');
  });

  test('criar campanha (rascunho) aparece na lista', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/campanhas');
    await shot(page, 'campanhas-criar-inicio');

    await shot(page, 'campanhas-criar-meio');
    const { nome } = await criarCampanha(page);

    // A campanha recém-criada nasce como RASCUNHO. Confirma nome + badge "Rascunho".
    await expect(page.getByText(nome, { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Rascunho').first()).toBeVisible({ timeout: 15_000 });
    await shot(page, 'campanhas-criar-fim');
  });

  test('métricas da campanha não exibem NaN/undefined', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/campanhas');
    await shot(page, 'campanhas-metricas-inicio');

    // Cria uma campanha própria e abre seu detalhe → aba Métricas.
    const { id } = await criarCampanha(page);
    await page.getByTestId(`campanha-open-${id}`).click();
    await expect(page.getByTestId('modal-content')).toBeVisible({ timeout: 15_000 });

    // Vai pra aba "Métricas" (role=tab). As taxas usam fmtPct, que deve blindar
    // contra undefined/NaN (fix B5). Verificamos de verdade que nenhum valor quebra.
    await page.getByRole('tab', { name: 'Métricas' }).click();
    await shot(page, 'campanhas-metricas-meio');

    // Espera os cards de métrica montarem (Stat "Taxa envio" sempre existe quando
    // metricas carregou). Tolera o estado "Carregando métricas…".
    await expect(page.getByText(/Taxa envio|Carregando métricas/).first()).toBeVisible({ timeout: 15_000 });

    const detalhe = await page.getByTestId('modal-content').innerText();
    expect(detalhe, 'métricas não devem conter NaN').not.toMatch(/\bNaN\b/);
    expect(detalhe, 'métricas não devem conter undefined').not.toMatch(/\bundefined\b/);
    // Sanidade extra: percentuais bem formatados terminam em "%", nunca "NaN%".
    expect(detalhe).not.toMatch(/NaN\s*%/);

    // Fecha sem disparar.
    await page.getByTestId('modal-close').first().click();
    await shot(page, 'campanhas-metricas-fim');
  });

  test('filtros de status e canal mudam a lista sem quebrar', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/campanhas');
    await shot(page, 'campanhas-filtros-inicio');

    await expect(page.getByRole('heading', { name: 'Campanhas' })).toBeVisible({ timeout: 15_000 });

    // Helper local: depois de filtrar, a lista deve chegar a um estado TERMINAL
    // (tabela com linhas OU empty state amigável) sem cair no ErrorBoundary.
    // IMPORTANTE: NÃO usar getByText('Rascunho'/'WhatsApp') pra validar — esses
    // textos também existem como <option> dentro dos próprios <select> de filtro
    // (elementos hidden), e o locator resolveria pra eles em vez da célula da
    // tabela. Validamos a refeitura da lista pela contagem de `data-row`/empty.
    const listaTerminou = async () => {
      await expect(async () => {
        const n = await rows(page).count();
        const vazio = await page.getByTestId('state-empty').isVisible().catch(() => false);
        // Ou há linhas, ou o empty state apareceu. (n>=0 sempre; exigimos sinal real.)
        expect(n > 0 || vazio).toBe(true);
      }).toPass({ timeout: 15_000 });
      // Nunca pode ter quebrado no ErrorBoundary.
      await expect(page.getByTestId('error-boundary-fallback')).toHaveCount(0);
    };

    // Filtro por status RASCUNHO. Confirma que o <select> pegou o valor e a lista
    // refez sem quebrar.
    await page.getByTestId('filter-status').selectOption('RASCUNHO');
    await expect(page.getByTestId('filter-status')).toHaveValue('RASCUNHO');
    await shot(page, 'campanhas-filtros-meio');
    await listaTerminou();

    // Limpa status e aplica filtro por canal WhatsApp. Mesma garantia de robustez.
    await page.getByTestId('filter-status').selectOption('');
    await expect(page.getByTestId('filter-status')).toHaveValue('');
    await page.getByTestId('filter-canal').selectOption('WHATSAPP');
    await expect(page.getByTestId('filter-canal')).toHaveValue('WHATSAPP');
    await listaTerminou();

    // A LISTA (tabela ou empty) segue íntegra depois de filtrar — sem NaN/undefined.
    // Escopo na área da lista (não no body inteiro) pra não colidir com outros
    // blocos da página que não fazem parte deste cenário de filtros.
    const lista = page.locator('[data-testid="data-table"], [data-testid="state-empty"]').first();
    const listaText = await lista.innerText();
    expect(listaText).not.toMatch(/\bNaN\b/);
    expect(listaText).not.toMatch(/\bundefined\b/);
    await shot(page, 'campanhas-filtros-fim');
  });
});
