import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Segmentações — builder de regras encadeáveis (rota /segmentos).
 *
 * Padrão herdado de clientes.spec.ts: login pela UI com diretorA (DIRECTOR,
 * acesso completo na empresa A), navega pra /segmentos e exercita o fluxo real
 * contra frontend(5174)+backend(4001).
 *
 * ── Selectors reais (lidos de SegmentosPage.tsx) ────────────────────────────
 * IMPORTANTE: a página NÃO tem data-testid próprio — só getByRole/getByText.
 *  - "Novo segmento" ........ getByRole('button', { name: 'Novo segmento' })
 *  - Builder é um OVERLAY full-page (NÃO o Dialog `modal-overlay`):
 *      <div className="fixed inset-0 z-[110] bg-bg ...">
 *  - Nome do segmento ....... Input no header, placeholder "Nome do segmento"
 *  - Regras (ConditionRow): cada linha tem 2 <select> + 1 <input placeholder="Valor">
 *      • campo (1º select)  → option labels: Status, UF, Cidade, Segmento, etc.
 *      • operador (2º select) → option labels: "igual a", "diferente de", …
 *      • valor (input)      → placeholder "Valor" (ou "valor1, valor2, ..." se op=in)
 *      Condição default ao abrir: campo=Status, op="igual a", valor="ATIVO".
 *  - "Adicionar regra" ...... getByRole('button', { name: 'Adicionar regra' })
 *  - Salvar ................. getByRole('button', { name: 'Salvar' })
 *  - Erro de validação ...... <div class="...text-danger...">{error}</div>
 *      `apiErrorMessage(err)` cai aqui → é onde "Dados inválidos" apareceria.
 *  - Sucesso ................ toast `toast-success` ("Segmento criado") e o builder
 *      fecha (onSaved → volta pra lista de cards).
 *  - Preview ao vivo ........ <aside> à direita; "Calculando…" enquanto roda; depois
 *      o total ("N clientes batem com essas regras"). É auto-disparado (debounce 500ms)
 *      a cada mudança de regra — não há botão; só precisamos não quebrar.
 *  - Card de segmento na lista: <h3> com o nome (getByText).
 *
 * RISCO destacado no enunciado: salvar uma regra VÁLIDA e mesmo assim receber
 * "Dados inválidos". Este teste cria a regra mínima válida (uf = SP) e FALHA
 * de propósito se esse texto aparecer (bug real, não mascarar).
 */

/** Localiza o overlay full-page do builder (não tem testid; ancoramos pelo input do nome). */
function builder(page: Page) {
  // O input do nome só existe dentro do builder; usamos o <header> que o contém.
  return page.getByPlaceholder('Nome do segmento');
}

test.describe('Segmentações @regression', () => {
  test('página de segmentos carrega', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/segmentos');
    await shot(page, 'segmentos-carrega-inicio');

    // O cabeçalho da PageLayout ("Segmentação") deve aparecer, e o botão de criar.
    await expect(
      page.getByRole('heading', { name: 'Segmentação' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Novo segmento' })).toBeVisible();

    // Sem formatação quebrada na listagem.
    await expect(page.locator('body')).not.toContainText('NaN');
    await expect(page.locator('body')).not.toContainText('undefined');

    await shot(page, 'segmentos-carrega-fim');
  });

  test('criar segmento com regra válida (uf = SP) salva SEM "Dados inválidos"', async ({
    page,
  }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/segmentos');
    await shot(page, 'segmentos-criar-inicio');

    const nome = `Seg E2E ${Date.now()}`;

    // Abre o builder full-page.
    await page.getByRole('button', { name: 'Novo segmento' }).click();
    await expect(builder(page)).toBeVisible({ timeout: 15_000 });

    // Nome único.
    await builder(page).fill(nome);

    // ── Monta a regra mínima VÁLIDA: campo=UF, operador="igual a", valor=SP ──
    // A 1ª condição já vem renderizada (status/eq/ATIVO). Editamos ela in-place.
    // Cada ConditionRow tem 2 <select> e 1 <input placeholder="Valor">. Como a
    // página não tem testid, escopamos pelos selects nativos da área de regras.
    const selects = page.locator('select');
    // 1º select da 1ª regra = campo. (O select de lógica "Combinar com" também é
    // um <select>, mas vem ANTES no DOM com options "TODAS (E)"/"QUALQUER UMA (OU)";
    // por isso selecionamos o de campo pela presença da option "UF".)
    const campoSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'UF' }) })
      .first();
    await campoSelect.selectOption({ label: 'UF' });

    // Operador: depois de trocar o campo pra UF, as ops válidas são eq/neq/in.
    // Pega o select que tem a option "igual a".
    const opSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'igual a' }) })
      .first();
    await opSelect.selectOption({ label: 'igual a' });

    // Valor: o input de valor da regra (placeholder "Valor").
    const valorInput = page.getByPlaceholder('Valor').first();
    await valorInput.fill('SP');
    await expect(valorInput).toHaveValue('SP');

    await shot(page, 'segmentos-criar-form');

    // O preview ao vivo dispara sozinho (debounce 500ms). Damos um tempinho pra
    // ele rodar e garantimos que não quebrou a tela (sem crash/NaN). Resiliente:
    // aceita "Calculando…", o total, "Nenhum cliente..." ou "Aguardando regras…".
    await expect(page.locator('body')).not.toContainText('NaN');

    // Salva.
    await page.getByRole('button', { name: 'Salvar' }).click();

    // ── BUG-HUNT: regra válida NÃO pode retornar "Dados inválidos" ──
    // O texto de erro do builder (apiErrorMessage) renderiza num div .text-danger.
    // Se ele aparecer com "Dados inválidos", deixamos FALHAR (bug real).
    await expect(
      page.getByText(/Dados inválidos/i),
      'salvar segmento com regra válida (uf=SP) não deveria retornar "Dados inválidos"',
    ).toHaveCount(0, { timeout: 12_000 });

    // Sucesso esperado: toast "Segmento criado" OU o builder fecha (volta à lista)
    // e o card com o nome aparece. Aceitamos qualquer um dos sinais (resiliente).
    const toast = page.getByTestId('toast-success');
    await Promise.race([
      toast.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => undefined),
      builder(page).waitFor({ state: 'hidden', timeout: 12_000 }).catch(() => undefined),
    ]);

    // Verificação dura: o builder fechou e o segmento existe na lista de cards.
    await expect(builder(page)).toBeHidden({ timeout: 12_000 });
    await expect(page.getByText(nome, { exact: false }).first()).toBeVisible({
      timeout: 12_000,
    });
    await shot(page, 'segmentos-criar-fim');
  });

  test('preview de clientes roda sem quebrar', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/segmentos');
    await shot(page, 'segmentos-preview-inicio');

    // Abre o builder. A condição default (status = ATIVO) já dispara um preview.
    await page.getByRole('button', { name: 'Novo segmento' }).click();
    await expect(builder(page)).toBeVisible({ timeout: 15_000 });

    // O preview ao vivo é auto-disparado (debounce 500ms). Não há botão. Garantimos
    // que a coluna de preview chega a um estado terminal sem quebrar a página.
    // Estados possíveis (todos OK): "Calculando…", o card de total
    // ("clientes batem com essas regras"), "Nenhum cliente bate..." ou
    // "Aguardando regras…".
    const previewEstavel = page
      .getByText(/clientes batem com essas regras|Nenhum cliente bate|Aguardando regras/i)
      .first();
    await expect(previewEstavel).toBeVisible({ timeout: 15_000 });
    await shot(page, 'segmentos-preview-meio');

    // Troca o campo pra UF / valor SP e confirma que o preview re-roda sem crashar.
    const campoSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'UF' }) })
      .first();
    await campoSelect.selectOption({ label: 'UF' });
    await page.getByPlaceholder('Valor').first().fill('SP');

    // Re-estabiliza sem NaN/Invalid na tela.
    await expect(previewEstavel).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).not.toContainText('NaN');
    await expect(page.locator('body')).not.toContainText('Invalid Date');
    await shot(page, 'segmentos-preview-fim');
  });
});
