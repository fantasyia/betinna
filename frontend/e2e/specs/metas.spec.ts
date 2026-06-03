import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Metas — alvos de faturamento/pedidos por rep, gerente ou empresa (rota /metas).
 *
 * Padrão herdado de clientes.spec.ts: login com diretorA (DIRECTOR), navega pra
 * /metas e exercita o fluxo real contra frontend(5174)+backend(4001).
 *
 * ── Selectors reais (lidos de MetasPage.tsx) ────────────────────────────────
 * A página usa o <Dialog> (testid `modal-overlay`) e campos via <Field label>
 * (getByLabel resolve — o `required` é um <span>* separado, então o nome do
 * label é só "Título", "Tipo", etc. SEM asterisco).
 *  - "Nova meta" ............ getByRole('button', { name: 'Nova meta' })
 *  - Form (Dialog "Nova meta"):
 *      • Título ............. getByLabel('Título')           (required)
 *      • Descrição .......... getByLabel('Descrição')
 *      • Tipo ............... getByLabel('Tipo')  <select> FATURAMENTO|PEDIDOS
 *      • Valor alvo ......... LABEL MUDA conforme tipo:
 *           FATURAMENTO → "Valor alvo (R$)" ; PEDIDOS → "Quantidade alvo"
 *      • Aplica a ........... getByLabel('Aplica a') <select> REP|GERENTE|EMPRESA
 *           (ao escolher EMPRESA, some o combobox de usuário → não precisa selecionar rep)
 *      • Período ............ getByLabel('Período') <select> MES|TRIMESTRE|ANO
 *      • Início ............. getByLabel('Início')  <input type=date>
 *      • Fim ................ getByLabel('Fim')     <input type=date>
 *  - Salvar ................. getByRole('button', { name: 'Salvar' })
 *  - Erro de validação ...... <div class="...text-danger...">{error}</div>
 *  - Card criado ............ <h3> com o título da meta (getByText).
 *  - `meta-dias-restantes` .. data-testid presente em cada card.
 *
 * BUG-HUNT (enunciado): período incoerente (fim < início). O handleSave de
 * MetaFormDialog valida título, valorAlvo>0 e alvo — mas NÃO valida fim>início.
 * Logo, o app provavelmente ACEITA datas incoerentes. O teste 2 tenta criar
 * uma meta com fim antes do início e:
 *   - PASSA se o app barrar (erro client OU backend rejeita → card não aparece);
 *   - FALHA (ANOTADO) se a meta for criada mesmo assim — período incoerente aceito.
 */

const MODAL = 'modal-overlay';

/** Preenche o form de meta (modal já aberto) com os campos básicos válidos. */
async function preencherMeta(
  page: Page,
  opts: {
    titulo: string;
    tipo?: 'Faturamento (R$)' | 'Pedidos (contagem)';
    valor?: string;
    inicio: string; // yyyy-mm-dd
    fim: string; // yyyy-mm-dd
  },
): Promise<void> {
  const modal = page.getByTestId(MODAL);

  await modal.getByLabel('Título').fill(opts.titulo);

  // Tipo (default já é FATURAMENTO). Se pedido, troca.
  if (opts.tipo) {
    await modal.getByLabel('Tipo').selectOption({ label: opts.tipo });
  }

  // Alvo = EMPRESA → não exige selecionar rep/gerente (evita depender do combobox).
  await modal.getByLabel('Aplica a').selectOption('EMPRESA');

  // Valor alvo — o label muda conforme o tipo. Resolve por qualquer um dos dois.
  if (opts.valor) {
    const valorAlvo = modal
      .getByLabel('Valor alvo (R$)')
      .or(modal.getByLabel('Quantidade alvo'));
    await valorAlvo.fill(opts.valor);
  }

  // Datas (inputs nativos type=date — fill aceita yyyy-mm-dd).
  await modal.getByLabel('Início').fill(opts.inicio);
  await modal.getByLabel('Fim').fill(opts.fim);
}

test.describe('Metas @regression', () => {
  test('página de metas carrega', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/metas');
    await shot(page, 'metas-carrega-inicio');

    await expect(page.getByRole('heading', { name: 'Metas' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Nova meta' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('NaN');
    await shot(page, 'metas-carrega-fim');
  });

  test('criar meta com período coerente aparece como card', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/metas');
    await shot(page, 'metas-criar-inicio');

    const titulo = `Meta E2E ${Date.now()}`;

    // Período COERENTE: início hoje, fim daqui a ~30 dias (datas válidas e ordenadas).
    const hoje = new Date();
    const fim = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);

    await page.getByRole('button', { name: 'Nova meta' }).click();
    await expect(page.getByTestId(MODAL)).toBeVisible({ timeout: 15_000 });
    await shot(page, 'metas-criar-form');

    await preencherMeta(page, {
      titulo,
      tipo: 'Faturamento (R$)',
      valor: '50000',
      inicio: ymd(hoje),
      fim: ymd(fim),
    });

    await page.getByRole('button', { name: 'Salvar' }).click();

    // Sucesso: o modal fecha (onSaved → refetch) sem erro de validação.
    await expect(
      page.getByText(/Dados inválidos/i),
      'criar meta válida não deveria retornar "Dados inválidos"',
    ).toHaveCount(0, { timeout: 12_000 });
    await expect(page.getByTestId(MODAL)).toBeHidden({ timeout: 12_000 });

    // O card da meta aparece com o título único.
    await expect(page.getByText(titulo, { exact: false }).first()).toBeVisible({
      timeout: 12_000,
    });

    // `meta-dias-restantes` visível em ao menos um card.
    await expect(page.getByTestId('meta-dias-restantes').first()).toBeVisible({
      timeout: 12_000,
    });
    await shot(page, 'metas-criar-fim');
  });

  test('período incoerente (fim antes do início) deve ser barrado', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/metas');
    await shot(page, 'metas-incoerente-inicio');

    const titulo = `Meta INCOERENTE ${Date.now()}`;

    // Período INCOERENTE de propósito: fim ANTES do início.
    const inicio = new Date();
    const fim = new Date(inicio.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 dias ANTES
    const ymd = (d: Date) => d.toISOString().slice(0, 10);

    await page.getByRole('button', { name: 'Nova meta' }).click();
    await expect(page.getByTestId(MODAL)).toBeVisible({ timeout: 15_000 });

    await preencherMeta(page, {
      titulo,
      tipo: 'Faturamento (R$)',
      valor: '50000',
      inicio: ymd(inicio),
      fim: ymd(fim),
    });
    await shot(page, 'metas-incoerente-form');

    await page.getByRole('button', { name: 'Salvar' }).click();

    // ── COMPORTAMENTO ESPERADO (correto): o app barra o período incoerente ──
    // Sinal de "barrado" = (a) erro visível no modal (client-side OU msg do backend)
    // E o modal continua aberto, OU (b) o backend rejeita e o card NUNCA aparece.
    //
    // ⚠️ BUG CONHECIDO/ANTECIPADO: MetaFormDialog.handleSave NÃO valida fim>início.
    // Se o backend também não validar, a meta é criada → o modal fecha e o card
    // aparece. Nesse caso este teste FALHA de propósito (não mascarar o bug).
    const modalAindaAberto = page.getByTestId(MODAL);
    const erroNoModal = modalAindaAberto.getByText(
      /(in[ií]cio|fim|per[ií]odo|data|inv[aá]lid)/i,
    );

    // Espera um estado terminal: ou erro+modal aberto, ou modal fechado.
    await expect(async () => {
      const aberto = await modalAindaAberto.isVisible().catch(() => false);
      const temErro = aberto && (await erroNoModal.first().isVisible().catch(() => false));
      // Terminal quando: (modal fechou) OU (erro apareceu).
      expect(temErro || !aberto).toBe(true);
    }).toPass({ timeout: 12_000 });

    await shot(page, 'metas-incoerente-meio');

    const aberto = await modalAindaAberto.isVisible().catch(() => false);
    if (aberto) {
      // CAMINHO BOM: app barrou — erro exibido e modal permanece aberto.
      await expect(
        erroNoModal.first(),
        'esperava mensagem de erro sobre o período incoerente',
      ).toBeVisible();
    } else {
      // Modal fechou → meta foi salva. Confirma se o card incoerente entrou na lista.
      // Se entrou, é BUG (período incoerente aceito). Afirma a AUSÊNCIA do card;
      // a asserção FALHA quando o bug está presente — exatamente o que queremos ANOTAR.
      await expect(
        page.getByText(titulo, { exact: false }),
        'BUG: meta com período incoerente (fim < início) foi aceita/criada — ' +
          'MetaFormDialog não valida fim>início e o backend não barrou.',
      ).toHaveCount(0, { timeout: 8_000 });
    }
    await shot(page, 'metas-incoerente-fim');
  });
});
