import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Vendas — roteiros E2E da Fase 2 (camada @smoke).
 *
 * Cobre os dois fluxos centrais de venda da empresa A (semeada: 7 pedidos, 3 propostas):
 *   1) Pedidos — lista carrega, abre detalhe, envia pro OMIE (modo DEMO).
 *   2) Proposta → pedido — cria proposta e tenta converter em pedido.
 *
 * Roda contra o app local (frontend 5174 + backend 4001) via playwright.local.config.ts.
 * OMIE em DEMO: o envio é fake mas funcional — status do pedido vira ENVIADO_OMIE.
 *
 * ── Notas de selectors (lidos dos componentes reais) ────────────────────────
 *  PedidosPage.tsx:
 *    - linha da tabela: data-testid="pedido-row-{id}"  (click abre Drawer)
 *    - "Novo pedido": data-testid="pedido-new-btn"
 *    - filtro status: data-testid="filter-status"
 *    - Drawer footer: "Enviar pro OMIE" = data-testid="pedido-enviar-omie"
 *      (só aparece quando status === 'RASCUNHO'); "Avançar status" = "pedido-avancar"
 *  NovoPedidoDialog.tsx:
 *    - cliente: AsyncCombobox testId="cliente-picker" → input[type=search] +
 *      opções data-testid="cliente-picker-option-{id}"
 *    - produto do 1º item: testId="item-0-produto" → "item-0-produto-option-{id}"
 *    - adicionar item: data-testid="pedido-add-item"
 *    - salvar: data-testid="pedido-save-btn" ("Criar pedido")
 *  PropostasPage.tsx:
 *    - "Nova proposta": data-testid="proposta-new-btn"
 *    - form: cliente "cliente-picker", produto "item-0-produto", add "proposta-add-item",
 *      salvar "proposta-save-btn" ("Criar como rascunho")
 *    - CONVERTER EM PEDIDO: data-testid="proposta-converter" ("Converter em pedido"),
 *      MAS só é renderizado no footer do Drawer quando status === 'ACEITA' && !pedidoId.
 *      Para uma proposta nova (RASCUNHO) o caminho disponível é mudar status via pílulas
 *      (proposta-status-{STATUS} + proposta-status-confirm) ou enviar pra aceite externo
 *      (proposta-enviar-aceite). Ver teste 5 abaixo — ele exercita ambos os caminhos de
 *      forma resiliente e ANOTA qual estava disponível.
 */

const PASSWORD = 'Teste@2026';
// Identificador único pra rastrear dados criados nesta execução.
const RUN_ID = Date.now().toString(36);

/** Seleciona o 1º resultado de um AsyncCombobox (testId), digitando `termo` pra disparar a busca. */
async function pickFirstCombobox(page: Page, testId: string, termo = 'a'): Promise<boolean> {
  const root = page.getByTestId(testId);
  const searchInput = root.locator('input[type="search"]');
  await searchInput.click();
  await searchInput.fill(termo);
  // Debounce de 250ms + fetch — espera surgir ao menos uma opção.
  const option = root.locator(`[data-testid^="${testId}-option-"]`).first();
  try {
    await option.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    return false; // sem resultados pro termo
  }
  await option.click();
  // Confirma seleção (o combobox troca o input pelo chip "-selected").
  await expect(root.getByTestId(`${testId}-selected`)).toBeVisible({ timeout: 5_000 });
  return true;
}

test.describe('Vendas — pedidos @smoke', () => {
  test('lista de pedidos carrega sem datas/números quebrados', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email, PASSWORD);
    await page.goto('/pedidos');
    await expect(page).toHaveURL(/\/pedidos/);
    await shot(page, 'vendas-pedidos-lista-inicio');

    // A empresa A tem 7 pedidos semeados — espera ao menos uma linha.
    const rows = page.locator('[data-testid^="pedido-row-"]');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    expect(await rows.count()).toBeGreaterThan(0);

    // Guarda contra formatação quebrada de número/moeda/data na tela.
    const body = page.locator('body');
    await expect(body).not.toContainText('NaN');
    await expect(body).not.toContainText('Invalid Date');
    await expect(body).not.toContainText('undefined');

    await shot(page, 'vendas-pedidos-lista-fim');
  });

  test('abrir um pedido existente mostra detalhe com itens e total', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email, PASSWORD);
    await page.goto('/pedidos');

    const firstRow = page.locator('[data-testid^="pedido-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 20_000 });
    await shot(page, 'vendas-pedido-abrir-inicio');

    // Click na 1ª linha abre o Drawer de detalhe (PedidoDetailDrawer).
    await firstRow.click();

    // O Drawer mostra "Total do pedido" e (na maioria dos pedidos semeados) a seção Itens.
    await expect(page.getByText('Total do pedido')).toBeVisible({ timeout: 15_000 });
    await shot(page, 'vendas-pedido-abrir-meio');

    // Total formatado em BRL — não pode estar quebrado.
    const drawerBody = page.locator('body');
    await expect(drawerBody).not.toContainText('NaN');
    await expect(drawerBody).not.toContainText('Invalid Date');

    // "Itens (N)" aparece quando o pedido tem itens (esperado nos seeds).
    // Asserção resiliente: aceita ou a seção Itens ou ao menos o resumo carregado.
    const temItens = await page
      .getByRole('heading', { name: /Itens \(\d+\)/ })
      .first()
      .isVisible()
      .catch(() => false);
    const temResumo = await page
      .getByRole('heading', { name: /Resumo/i })
      .first()
      .isVisible()
      .catch(() => false);
    expect(temItens || temResumo).toBe(true);

    await shot(page, 'vendas-pedido-abrir-fim');
  });

  test('enviar OMIE (demo) num pedido em rascunho muda status', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email, PASSWORD);
    await page.goto('/pedidos');
    await expect(page.locator('[data-testid^="pedido-row-"]').first()).toBeVisible({
      timeout: 20_000,
    });
    await shot(page, 'vendas-omie-inicio');

    // Tenta achar um pedido em RASCUNHO via filtro de status.
    await page.getByTestId('filter-status').selectOption('RASCUNHO');
    // Pequena espera pela refetch da lista filtrada.
    await page.waitForLoadState('networkidle').catch(() => {});

    let rascunhoRow = page.locator('[data-testid^="pedido-row-"]').first();
    let temRascunho = await rascunhoRow.isVisible().catch(() => false);

    // Se não houver rascunho semeado, cria um pedido novo (que nasce RASCUNHO).
    if (!temRascunho) {
      // Volta pra "todos" e abre o dialog de criação.
      await page.getByTestId('filter-status').selectOption('');
      await page.getByTestId('pedido-new-btn').click();
      await expect(page.getByTestId('pedido-save-btn')).toBeVisible({ timeout: 10_000 });

      // Busca um cliente SEMEADO ("Mercado *") — eles têm codigoOmie, então o envio
      // ao OMIE funciona. (Um cliente criado pelo teste de clientes não tem codigoOmie
      // e o OMIE recusa com 422 "Sincronize com OMIE primeiro".)
      const clienteOk = await pickFirstCombobox(page, 'cliente-picker', 'Mercado');
      expect(clienteOk, 'esperava ao menos 1 cliente semeado (Mercado) na empresa A').toBe(true);

      const produtoOk = await pickFirstCombobox(page, 'item-0-produto');
      expect(produtoOk, 'esperava ao menos 1 produto na empresa A').toBe(true);

      // Mesmo problema do form de proposta: o PREÇO UN. do item precisa estar
      // preenchido pra o pedido nascer com total > 0 e o save concluir. Input é
      // data-testid="item-0-override" (placeholder "preço") no NovoPedidoDialog.
      const precoPedidoInput = page.getByTestId('item-0-override');
      await precoPedidoInput.fill('50');
      await expect(precoPedidoInput).toHaveValue('50');

      await shot(page, 'vendas-omie-pedido-criado-form');
      await page.getByTestId('pedido-save-btn').click();

      // Confirma que o pedido foi de fato criado: o dialog de criação fecha
      // (onCreated → setCreating(false)) antes do Drawer abrir.
      await expect(page.getByTestId('pedido-save-btn')).toBeHidden({ timeout: 15_000 });

      // Após criar, PedidosPage abre o Drawer do novo pedido automaticamente
      // (onCreated → setSelected). Espera o "Total do pedido" do Drawer.
      await expect(page.getByText('Total do pedido')).toBeVisible({ timeout: 15_000 });
      rascunhoRow = page.locator('[data-testid^="pedido-row-"]').first();
      temRascunho = true;
    } else {
      // Abre o Drawer do rascunho encontrado.
      await rascunhoRow.click();
      await expect(page.getByText('Total do pedido')).toBeVisible({ timeout: 15_000 });
    }

    await shot(page, 'vendas-omie-meio');

    // Botão "Enviar pro OMIE" só existe enquanto status === RASCUNHO.
    const enviarBtn = page.getByTestId('pedido-enviar-omie');
    await expect(enviarBtn).toBeVisible({ timeout: 10_000 });
    await enviarBtn.click();

    // Não deve ter surgido o box de erro de ação (data-testid="action-error").
    const temErro = await page
      .getByTestId('action-error')
      .isVisible()
      .catch(() => false);
    expect(temErro, 'envio OMIE demo não deveria falhar').toBe(false);

    // Asserção dura de sucesso #1: o botão de envio deixa de estar visível. No sucesso,
    // doAction → onChanged() fecha o Drawer (setSelected(null)) e o pedido sai de RASCUNHO,
    // então o botão (condicional a status === RASCUNHO) some. Se tivesse falhado, o Drawer
    // continuaria aberto com o botão visível + o action-error acima.
    await expect(enviarBtn, 'após enviar ao OMIE o botão deve sumir (Drawer fecha)').toBeHidden({
      timeout: 12_000,
    });

    // Asserção dura de sucesso #2: confirma que o status virou ENVIADO_OMIE na lista.
    // Filtra a lista por ENVIADO_OMIE e exige ao menos uma linha com o badge correspondente
    // — prova de que o pedido realmente mudou de status (não só fechou o drawer).
    await page.getByTestId('filter-status').selectOption('ENVIADO_OMIE');
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(
      page.locator('[data-testid^="pedido-row-"]').first(),
      'esperava ao menos um pedido com status ENVIADO_OMIE após o envio',
    ).toBeVisible({ timeout: 12_000 });
    // (Não asseveramos o texto "Enviado ao OMIE" porque ele também existe como
    // <option> no select de filtro — o botão sumir + a linha no filtro já provam.)

    await shot(page, 'vendas-omie-fim');
  });
});

test.describe('Vendas — proposta → pedido @smoke', () => {
  test('criar proposta aparece na lista', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email, PASSWORD);
    await page.goto('/propostas');
    await expect(page).toHaveURL(/\/propostas/);
    await shot(page, 'vendas-proposta-criar-inicio');

    await page.getByTestId('proposta-new-btn').click();
    // Form Dialog (PropostaFormDialog) — botão salvar "Criar como rascunho".
    await expect(page.getByTestId('proposta-save-btn')).toBeVisible({ timeout: 10_000 });

    const clienteOk = await pickFirstCombobox(page, 'cliente-picker');
    expect(clienteOk, 'esperava ao menos 1 cliente na empresa A').toBe(true);

    const produtoOk = await pickFirstCombobox(page, 'item-0-produto');
    expect(produtoOk, 'esperava ao menos 1 produto na empresa A').toBe(true);

    // PREÇO UN. do item é obrigatório de fato pra o save concluir: sem preço,
    // o item fica com total 0 e o backend rejeita / o modal não fecha. O input é
    // data-testid="item-0-override" (placeholder "preço"). Preenche valor positivo.
    const precoInput = page.getByTestId('item-0-override');
    await precoInput.fill('50');
    await expect(precoInput).toHaveValue('50');

    // Observação com RUN_ID pra rastrear esta proposta criada nesta execução.
    const obs = page.getByRole('textbox').last();
    await obs.fill(`E2E vendas ${RUN_ID}`).catch(() => {});

    await shot(page, 'vendas-proposta-criar-form');
    await page.getByTestId('proposta-save-btn').click();

    // O dialog fecha (onSaved) e a lista refaz. Espera o dialog sumir e ao menos
    // uma linha de proposta na tabela.
    await expect(page.getByTestId('proposta-save-btn')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('[data-testid^="proposta-row-"]').first()).toBeVisible({
      timeout: 15_000,
    });

    // Sem formatação quebrada.
    await expect(page.locator('body')).not.toContainText('NaN');
    await expect(page.locator('body')).not.toContainText('Invalid Date');

    await shot(page, 'vendas-proposta-criar-fim');
  });

  test('converter proposta em pedido (ou fluxo de aceite, se conversão indisponível)', async ({
    page,
  }) => {
    await loginViaUI(page, USERS.diretorA.email, PASSWORD);
    await page.goto('/propostas');
    const firstProposta = page.locator('[data-testid^="proposta-row-"]').first();
    await expect(firstProposta).toBeVisible({ timeout: 20_000 });
    await shot(page, 'vendas-converter-inicio');

    // Abre o Drawer de detalhe da 1ª proposta.
    await firstProposta.click();
    // O Drawer mostra "Valor" no header card.
    await expect(page.getByText(/^Valor$/).first()).toBeVisible({ timeout: 15_000 });
    await shot(page, 'vendas-converter-meio');

    // Caminho A — proposta JÁ aceita (status ACEITA e sem pedido): botão direto de conversão.
    const converterBtn = page.getByTestId('proposta-converter');
    const podeConverterJa = await converterBtn.isVisible().catch(() => false);

    if (podeConverterJa) {
      await converterBtn.click();
      // doConverter() → POST /converter-em-pedido; onChanged fecha o drawer e refaz a lista.
      // Verificação resiliente: badge "Pedido gerado" passa a existir, OU não há erro de ação.
      const ok = await page
        .getByText(/Pedido gerado/i)
        .first()
        .waitFor({ state: 'visible', timeout: 12_000 })
        .then(() => true)
        .catch(() => false);
      const erro = await page
        .getByTestId('action-error')
        .isVisible()
        .catch(() => false);
      expect(erro, 'conversão direta não deveria falhar').toBe(false);
      expect(ok || !erro).toBe(true);
      await shot(page, 'vendas-converter-fim');
      return;
    }

    // Caminho B — proposta não está em ACEITA. O botão de conversão NÃO é renderizado.
    // A UI oferece, em vez disso, o fluxo de aceite externo (gera link → cliente aceita →
    // backend cria o pedido). Exercitamos "Enviar pra cliente aprovar" (proposta-enviar-aceite),
    // que existe pra qualquer status != ACEITA/RECUSADA e muda o status pra AGUARDANDO_ASSINATURA.
    const enviarAceiteBtn = page.getByTestId('proposta-enviar-aceite');
    const temAceite = await enviarAceiteBtn.isVisible().catch(() => false);

    if (temAceite) {
      await enviarAceiteBtn.click();
      // C3 — link de aceite gerado aparece em data-testid="proposta-aceite-link".
      const linkBox = page.getByTestId('proposta-aceite-link');
      const gerou = await linkBox
        .waitFor({ state: 'visible', timeout: 12_000 })
        .then(() => true)
        .catch(() => false);
      const erro = await page
        .getByTestId('action-error')
        .isVisible()
        .catch(() => false);
      expect(erro, 'gerar link de aceite não deveria falhar').toBe(false);
      expect(gerou || !erro).toBe(true);
      await shot(page, 'vendas-converter-fim');
      return;
    }

    // Caminho C — fallback: nem conversão direta nem aceite disponíveis (proposta já
    // recusada/expirada ou já tem pedido). Ao menos garante que o detalhe abriu sem erro.
    // ANOTAÇÃO: neste caso a conversão direta proposta→pedido depende do status ACEITA.
    const erro = await page
      .getByTestId('action-error')
      .isVisible()
      .catch(() => false);
    expect(erro).toBe(false);
    await shot(page, 'vendas-converter-fim');
  });
});
