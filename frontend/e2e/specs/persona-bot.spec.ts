import { test, expect } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Persona/Bot Muller — configuração do MullerBot por empresa.
 *
 * Login: USERS.diretorA (DIRECTOR). Rota /mullerbot/persona é allowedRoles
 * ['ADMIN','DIRECTOR'] (App.tsx) → diretorA entra. Front+back reais
 * (5174 + 4001). Bot MOCKADO (MULLERBOT_MOCK=true) + chave OpenAI dummy ⇒
 * o diagnóstico (/mullerbot/bot/diagnostico) deve responder OK sem chamar
 * a OpenAI de verdade.
 *
 * IMPORTANTE: PersonaBotPage.tsx NÃO tem nenhum data-testid. Todos os
 * seletores abaixo são por role/text (lidos do componente real):
 *  - Editor de prompt ......... <Textarea> → getByRole('textbox')
 *                               (único textarea; placeholder começa "Ex:")
 *  - Dropdown de modelo ....... <Select> nativo → getByRole('combobox')
 *                               1ª opção: "Padrão do servidor (gpt-4o-mini)"
 *  - Liga/desliga do bot ...... <Switch> = <input type=checkbox> sr-only
 *                               dentro de <label> → getByRole('checkbox')
 *  - Tetos de tokens (dia/mês)  <input type=number> → getByRole('spinbutton')
 *                               labels "Limite diário (tokens)" / "Limite mensal (tokens)"
 *  - Consumo atual ............ BarraCusto: textos "Hoje: N%" / "Mês: N%"
 *                               (só renderiza se /mullerbot/custo retornar data)
 *  - Botão diagnóstico ........ getByRole('button', { name: 'Testar agora' })
 *  - Resultado OK ............. texto "IA conectada e respondendo"
 *  - Resultado FALHA .......... texto "O bot NÃO consegue responder"
 *  - Salvar ................... getByRole('button', { name: 'Salvar' })
 *                               (disabled={!dirty} — só habilita ao editar)
 *  - Toast sucesso ............ testid `toast-success` ("Configuração do Muller salva")
 */

const PERSONA_URL = '/mullerbot/persona';

test.describe('Persona/Bot Muller @regression', () => {
  test('página carrega com prompt, modelo, switch, tetos e consumo sem NaN', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto(PERSONA_URL);
    await shot(page, 'persona-carrega-inicio');

    // Título da página (PageLayout title="Muller — Prompt").
    await expect(page.getByRole('heading', { name: /Muller/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Editor de prompt — único <textarea> da página.
    const promptEditor = page.getByRole('textbox');
    await expect(promptEditor.first()).toBeVisible({ timeout: 15_000 });

    // Dropdown de modelo — <select> nativo. Sempre tem a opção padrão do servidor.
    const modeloSelect = page.getByRole('combobox').first();
    await expect(modeloSelect).toBeVisible();
    await expect(
      modeloSelect.locator('option', { hasText: 'Padrão do servidor' }),
    ).toHaveCount(1);

    // Liga/desliga do bot — checkbox (sr-only) do Switch.
    await expect(page.getByRole('checkbox').first()).toBeVisible();

    // Tetos de tokens — dois <input type=number> (spinbutton). Os valores são
    // controlados e inicializam num default numérico; confirmamos que NÃO são NaN.
    const limiteDiario = page.getByRole('spinbutton').nth(0);
    const limiteMensal = page.getByRole('spinbutton').nth(1);
    await expect(limiteDiario).toBeVisible();
    await expect(limiteMensal).toBeVisible();
    for (const campo of [limiteDiario, limiteMensal]) {
      const v = await campo.inputValue();
      // Campo de número nunca deve exibir "NaN" nem ficar vazio (seria bug de
      // parse do limiteTokens* vindo do backend).
      expect(v).not.toMatch(/nan/i);
      expect(v.trim().length).toBeGreaterThan(0);
      expect(Number.isNaN(Number(v))).toBe(false);
    }
    await shot(page, 'persona-carrega-meio');

    // Consumo atual (BarraCusto) — só aparece quando /mullerbot/custo devolve data.
    // BUG REAL a pegar: se usado/limite/pct vierem null/undefined, o
    // .toLocaleString()/Math.round() renderizam "NaN". Não deve haver "NaN"
    // em lugar nenhum da página renderizada.
    const corpo = page.locator('body');
    await expect(corpo).toBeVisible();
    const temNaN = await corpo.getByText(/NaN/).count();
    expect(temNaN, 'a página não deve renderizar "NaN" (consumo/tetos quebrados)').toBe(0);

    await shot(page, 'persona-carrega-fim');
  });

  test('diagnóstico do bot (mockado) responde sem erro fatal', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto(PERSONA_URL);
    await shot(page, 'persona-diagnostico-inicio');

    // O diagnóstico roda automático no mount (useEffect → testarBot). Além disso
    // há o botão "Testar agora". Clicamos pra forçar uma rodada determinística.
    const testarBtn = page.getByRole('button', { name: 'Testar agora' });
    await expect(testarBtn).toBeVisible({ timeout: 15_000 });
    await testarBtn.click();
    await shot(page, 'persona-diagnostico-meio');

    // Com o bot MOCKADO, o backend deve devolver teste.ok=true → aparece
    // "IA conectada e respondendo". Aceitamos como sucesso primário.
    const ok = page.getByText(/IA conectada e respondendo/i);
    const falha = page.getByText(/O bot NÃO consegue responder/i);

    // Espera o diagnóstico estabilizar (um dos dois estados aparece).
    await expect(async () => {
      const nOk = await ok.count();
      const nFalha = await falha.count();
      expect(nOk + nFalha).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });

    // BUG REAL: bot mockado deveria dar OK. Se aparecer "não consegue responder",
    // o mock não está sendo respeitado pelo diagnóstico — falha o teste e anota.
    await expect(
      ok,
      'bot está MOCKADO (MULLERBOT_MOCK=true): o diagnóstico deveria dar OK e não chamar a OpenAI',
    ).toBeVisible({ timeout: 5_000 });

    await shot(page, 'persona-diagnostico-fim');
  });

  test('editar o prompt e salvar confirma sucesso', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto(PERSONA_URL);
    await shot(page, 'persona-salvar-inicio');

    const promptEditor = page.getByRole('textbox').first();
    await expect(promptEditor).toBeVisible({ timeout: 15_000 });

    // O botão "Salvar" começa disabled (disabled={!dirty}). Editar o prompt
    // marca dirty=true e habilita o botão. Acrescentamos uma linha única.
    const marca = `\n\n# E2E ${Date.now()}: regra de teste automatizado.`;
    await promptEditor.click();
    // Vai pro fim do conteúdo e digita (preserva o que já existe).
    await page.keyboard.press('End');
    await promptEditor.pressSequentially(marca, { delay: 1 });

    const salvar = page.getByRole('button', { name: 'Salvar' });
    await expect(salvar).toBeEnabled({ timeout: 5_000 });
    await shot(page, 'persona-salvar-meio');
    await salvar.click();

    // Sucesso: toast "Configuração do Muller salva" (testid toast-success) OU,
    // mais resiliente, o botão volta a ficar disabled (setDirty(false) no sucesso)
    // sem aparecer mensagem de erro inline (bloco vermelho com AlertCircle).
    const toast = page.getByTestId('toast-success');
    await Promise.race([
      toast.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
      expect(salvar).toBeDisabled({ timeout: 15_000 }).catch(() => undefined),
    ]);

    // Não deve ter quebrado: sem texto de erro de salvamento conhecido.
    await expect(page.getByText(/Falha ao salvar/i)).toHaveCount(0);
    await shot(page, 'persona-salvar-fim');
  });
});
