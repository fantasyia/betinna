import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Integrações — catálogo de serviços da empresa + integrações pessoais.
 *
 * Login: USERS.diretorA (DIRECTOR). /integracoes é allowedRoles
 * ['ADMIN','DIRECTOR','GERENTE'] (App.tsx) → diretorA entra.
 * /minhas-integracoes é só ProtectedRoute (qualquer logado).
 *
 * NÃO conecta nada: não abre OAuth, não preenche credenciais, não pareia QR.
 * Apenas confirma que os cards renderizam e que, sem nada conectado no seed,
 * os badges mostram "não conectado".
 *
 * Seletores reais (lidos de IntegracoesPage.tsx + MinhasIntegracoesPage.tsx):
 *  EMPRESA (/integracoes):
 *   - Card por serviço ......... testid `servico-card-{servico}`
 *   - Badge conectado/não ...... testid `status-{servico}` → texto
 *                                "● conectado" | "○ não conectado"
 *   - Botão conectar ........... testid `conectar-{servico}` (NÃO clicar)
 *   - serviços: omie, whatsapp, mercadolivre, shopee, amazon, tiktok,
 *               instagram, facebook
 *   - Estados de fetch ......... StateView → testid state-loading/state-error
 *  USUÁRIO (/minhas-integracoes):
 *   - Card por serviço ......... testid `user-servico-card-{servico}`
 *   - Badge .................... testid `user-status-{servico}`
 *   - serviços: whatsapp, google_calendar, openai
 */

// Serviços EMPRESA na ordem do SERVICO_ORDER do componente.
const SERVICOS_EMPRESA = [
  'omie',
  'whatsapp',
  'mercadolivre',
  'shopee',
  'amazon',
  'tiktok',
  'instagram',
  'facebook',
] as const;

// Serviços USUÁRIO (MinhasIntegracoesPage SERVICO_ORDER).
const SERVICOS_USUARIO = ['whatsapp', 'google_calendar', 'openai'] as const;

/** Espera o StateView resolver (sai de loading e não está em erro). */
async function aguardarConteudo(page: Page): Promise<void> {
  await expect(page.getByTestId('state-loading')).toHaveCount(0, { timeout: 15_000 });
  // Se caiu em erro de fetch, deixamos a asserção do teste falhar com contexto.
  await expect(page.getByTestId('state-error')).toHaveCount(0, { timeout: 5_000 });
}

test.describe('Integrações @regression', () => {
  test('/integracoes: todos os cards de serviço da empresa renderizam', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/integracoes');
    await shot(page, 'integracoes-empresa-inicio');

    await expect(page.getByRole('heading', { name: /Integrações da empresa/i })).toBeVisible({
      timeout: 15_000,
    });
    await aguardarConteudo(page);
    await shot(page, 'integracoes-empresa-meio');

    // Cada card do catálogo deve estar presente e visível.
    for (const s of SERVICOS_EMPRESA) {
      await expect(
        page.getByTestId(`servico-card-${s}`),
        `card do serviço ${s} deveria renderizar`,
      ).toBeVisible({ timeout: 15_000 });
    }

    // A página não deve renderizar "NaN" em lugar nenhum.
    await expect(page.locator('body').getByText(/NaN/)).toHaveCount(0);
    await shot(page, 'integracoes-empresa-fim');
  });

  test('/integracoes: badges mostram "não conectado" (nada conectado no seed)', async ({
    page,
  }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/integracoes');
    await aguardarConteudo(page);
    await shot(page, 'integracoes-status-inicio');

    // Sem conexões no seed: cada badge de status deve dizer "não conectado".
    // Resiliente: se algum serviço estiver conectado no ambiente, anotamos via
    // mensagem da asserção em vez de quebrar todo o suite — mas o esperado é
    // "○ não conectado" pra todos.
    for (const s of SERVICOS_EMPRESA) {
      const badge = page.getByTestId(`status-${s}`);
      await expect(badge, `badge de status do ${s} deveria existir`).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        badge,
        `${s} deveria estar "não conectado" no seed (nada conectado)`,
      ).toHaveText(/não conectado/i);
      // Como não está conectado, o botão "Conectar" deve existir (NÃO clicamos).
      await expect(page.getByTestId(`conectar-${s}`)).toBeVisible();
    }

    await shot(page, 'integracoes-status-fim');
  });

  test('/minhas-integracoes: cards pessoais renderizam', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/minhas-integracoes');
    await shot(page, 'integracoes-pessoais-inicio');

    await expect(page.getByRole('heading', { name: /Minhas integrações/i })).toBeVisible({
      timeout: 15_000,
    });
    await aguardarConteudo(page);
    await shot(page, 'integracoes-pessoais-meio');

    // Cards pessoais: Google Calendar, OpenAI, WhatsApp pessoal.
    for (const s of SERVICOS_USUARIO) {
      await expect(
        page.getByTestId(`user-servico-card-${s}`),
        `card pessoal ${s} deveria renderizar`,
      ).toBeVisible({ timeout: 15_000 });
      // Badge de status existe (esperado "não conectado" no seed).
      await expect(page.getByTestId(`user-status-${s}`)).toBeVisible();
    }

    await expect(page.locator('body').getByText(/NaN/)).toHaveCount(0);
    await shot(page, 'integracoes-pessoais-fim');
  });
});
