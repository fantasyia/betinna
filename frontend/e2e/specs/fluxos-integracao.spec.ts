import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Fluxos de integração — CAMADA 4 (@regression).
 *
 * Exercita as bordas das integrações externas no ambiente local de pré-beta:
 *   - frontend http://localhost:5174  +  backend http://localhost:4001
 *   - OMIE em DEMO (envio fake mas funcional)
 *   - Resend VAZIO (sem RESEND_API_KEY) → enviar e-mail FALHA DE PROPÓSITO
 *   - bot Muller MOCKADO
 *   - WhatsApp real NÃO conectado (mas há conversas semeadas na Inbox)
 *
 * O objetivo desta camada NÃO é o caminho feliz, e sim provar que as FALHAS
 * são TRATADAS (toast/box de erro, sem crash) e que o "não conectado" aparece
 * de forma honesta na UI.
 *
 * Login: USERS.diretorA (DIRECTOR da empresa A — vê propostas, integrações e
 * todas as conversas da empresa A).
 *
 * ── Notas de selectors (lidos dos componentes reais) ────────────────────────
 *  PropostasPage.tsx (Drawer de detalhe da proposta):
 *    - linha da tabela ......... data-testid="proposta-row-{id}"  (click abre Drawer)
 *    - ENVIAR E-MAIL ........... data-testid="proposta-enviar-email" (texto "Enviar por e-mail")
 *      → chama POST /propostas/:id/enviar-email. Em FALHA seta `actionError`
 *        renderizado como data-testid="action-error" (box vermelho), NÃO um toast.
 *        Em SUCESSO mostra toast.success. Como o Resend está vazio, esperamos a
 *        falha tratada (action-error) e a tela INTACTA.
 *  IntegracoesPage.tsx:
 *    - card por serviço ........ data-testid="servico-card-{servico}"
 *    - badge de conexão ........ data-testid="status-{servico}" (texto "○ não conectado"
 *      quando desconectado / "● conectado" quando ativo)
 *    - serviços (SERVICO_ORDER): omie, whatsapp, mercadolivre, shopee, amazon,
 *      tiktok, instagram, facebook
 *  InboxPage.tsx:
 *    - busca ................... placeholder "Buscar…"
 *    - tab de canal ............ componente Tabs (itens "Todos"/"WA"/"IG"/"FB"/"EM")
 *      — NÃO tem testid dedicado; filtramos clicando no texto "WA".
 *    - card da conversa ........ data-testid="conv-card-{id}"
 *    - peer/telefone no header . data-testid="inbox-thread-peer"
 *
 * ── Investigação: endpoint pra SIMULAR recebimento de WhatsApp ───────────────
 *  NÃO EXISTE endpoint interno pra injetar mensagem inbound de WhatsApp.
 *  Verificado em backend/src/modules/inbox/inbox.controller.ts — só há rotas de
 *  LEITURA (GET /inbox, /:id, /:id/mensagens) e de AÇÃO do operador (responder,
 *  atribuir, status, notas, presença, bot). Não há rota dev/simular/webhook de
 *  WhatsApp: o Baileys é socket-based (não HTTP), então não há webhook de
 *  entrada. Os webhooks existentes são por canal e protegidos (ML por IP
 *  whitelist; Shopee/TikTok/Meta/OMIE por HMAC) — nenhum injeta WhatsApp.
 *  → Conclusão: o teste valida o que JÁ funciona (conversas WhatsApp semeadas
 *    aparecem no /inbox com mensagens). O "recebimento ao vivo" precisa de
 *    teste MANUAL com o WhatsApp real conectado. Ver ANOTAÇÃO no retorno.
 *
 * Dados semeados relevantes (seed-test.ts → empresa A):
 *  - 3 propostas (PROP-A-*) — usamos a 1ª linha da lista.
 *  - 2 conversas WhatsApp da empresa A: "João Mercado" e "Maria Distribuidora"
 *    (ambas ABERTA, com mensagens INBOUND + OUTBOUND). A 3ª conversa do seed é
 *    da empresa B — diretorA NÃO a vê (multi-tenant).
 */

// Serviços de integração esperados na página /integracoes (ordem do SERVICO_ORDER).
const SERVICOS = [
  'omie',
  'whatsapp',
  'mercadolivre',
  'shopee',
  'amazon',
  'tiktok',
  'instagram',
  'facebook',
] as const;

test.describe('Fluxos de integração @regression', () => {
  // ───────────────────────────────────────────────────────────────────────
  // 1. E-mail — fallback do Resend (Resend VAZIO → envio FALHA, tratado)
  // ───────────────────────────────────────────────────────────────────────
  test('enviar proposta por e-mail falha de forma tratada (Resend vazio)', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/propostas');
    await expect(page).toHaveURL(/\/propostas/);
    await shot(page, 'integracao-email-inicio');

    // Abre o Drawer de detalhe da 1ª proposta semeada (empresa A tem 3).
    const firstProposta = page.locator('[data-testid^="proposta-row-"]').first();
    await expect(firstProposta, 'esperava ao menos 1 proposta semeada na empresa A').toBeVisible({
      timeout: 20_000,
    });
    await firstProposta.click();

    // Drawer abriu — a barra de exportação/envio traz o botão de e-mail.
    const enviarEmailBtn = page.getByTestId('proposta-enviar-email');
    await expect(enviarEmailBtn, 'botão "Enviar por e-mail" deve existir no Drawer').toBeVisible({
      timeout: 15_000,
    });
    await shot(page, 'integracao-email-meio');

    // Snapshot da URL pra confirmar depois que a tela NÃO navegou/quebrou.
    const urlAntes = page.url();

    // Clica enviar. O envio NÃO exige preencher destinatário — o backend usa o
    // e-mail do cliente da proposta (POST /propostas/:id/enviar-email sem body).
    await enviarEmailBtn.click();

    // Resultado esperado: como o Resend está VAZIO, o backend lança
    // IntegrationException e o componente trata via `actionError` →
    // data-testid="action-error" (box vermelho). Aceitamos também um toast-error
    // (caso a UI mude pra toast no futuro). O que NÃO pode acontecer: crash,
    // toast de SUCESSO, ou a tela ficar presa em "carregando".
    const actionError = page.getByTestId('action-error');
    const toastError = page.getByTestId('toast-error');

    const erroTratado = await Promise.race([
      actionError
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => 'action-error')
        .catch(() => null),
      toastError
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => 'toast-error')
        .catch(() => null),
    ]);

    // BUG REAL se nenhum sinal de erro tratado apareceu: ou o envio "passou"
    // (impossível sem Resend — seria falso positivo do backend), ou a falha
    // derrubou a tela sem feedback. Deixamos falhar com mensagem clara.
    expect(
      erroTratado,
      'Resend vazio: enviar e-mail deveria mostrar erro TRATADO (action-error ou toast-error), ' +
        'não passar silenciosamente nem quebrar a tela',
    ).not.toBeNull();

    // Falha NÃO pode ter virado um falso "Proposta enviada" (toast de sucesso).
    const toastSucesso = await page
      .getByTestId('toast-success')
      .isVisible()
      .catch(() => false);
    expect(toastSucesso, 'não deveria aparecer toast de SUCESSO com o Resend vazio').toBe(false);

    // A tela continua de pé: mesma URL e o Drawer ainda mostra a proposta
    // (o "Valor" do header card segue visível — nada crashou/desmontou).
    expect(page.url(), 'a falha de e-mail não deveria navegar pra fora da página').toBe(urlAntes);
    await expect(
      page.getByText(/^Valor$/).first(),
      'o Drawer da proposta deve seguir montado após a falha de e-mail',
    ).toBeVisible();

    // Guarda anti-render-quebrado: a tela não deve mostrar texto cru de stack/crash.
    const body = page.locator('body');
    await expect(body).not.toContainText('Cannot read properties');
    await expect(body).not.toContainText('TypeError');
    await expect(body).not.toContainText('undefined is not');

    await shot(page, 'integracao-email-fim');
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. Marketplaces — cards mostram "não conectado" (sem clicar conectar)
  // ───────────────────────────────────────────────────────────────────────
  test('integrações mostram todos os serviços como não conectados', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/integracoes');
    await expect(page).toHaveURL(/\/integracoes/);
    await shot(page, 'integracao-cards-inicio');

    // Espera a grade de cards montar (1º card como âncora).
    await expect(page.getByTestId(`servico-card-${SERVICOS[0]}`)).toBeVisible({ timeout: 20_000 });
    await shot(page, 'integracao-cards-meio');

    // Cada serviço deve ter o card E o badge de status presentes. No ambiente de
    // teste nada está conectado, então o badge deve dizer "○ não conectado".
    for (const servico of SERVICOS) {
      const card = page.getByTestId(`servico-card-${servico}`);
      await expect(card, `card do serviço "${servico}" deveria aparecer`).toBeVisible();

      const status = page.getByTestId(`status-${servico}`);
      await expect(status, `badge status-${servico} deveria existir`).toBeVisible();

      // Texto exato do componente quando desconectado: "○ não conectado".
      // Asserção resiliente: confere a substring "não conectado" (a bolinha ○ é
      // decorativa e pode variar). Se algum serviço estiver, por acidente,
      // CONECTADO no ambiente, ANOTAMOS via mensagem em vez de mascarar.
      const txt = ((await status.textContent()) ?? '').trim();
      expect(
        txt,
        `badge status-${servico} deveria indicar desconexão ("○ não conectado"), veio: "${txt}". ` +
          `Se este serviço aparece CONECTADO, o ambiente de teste não está limpo.`,
      ).toContain('não conectado');
    }

    // Não clicamos em "Conectar" (não há credenciais reais no ambiente de teste).
    await shot(page, 'integracao-cards-fim');
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. WhatsApp — conversas semeadas caem no Inbox
  //    (não há endpoint de simulação — valida o que já funciona; ver ANOTAÇÃO)
  // ───────────────────────────────────────────────────────────────────────
  test('inbox mostra conversas WhatsApp semeadas com mensagens', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/inbox');
    await expect(page).toHaveURL(/\/inbox/);
    await shot(page, 'integracao-inbox-inicio');

    // A empresa A tem 2 conversas WhatsApp semeadas (João Mercado, Maria
    // Distribuidora). Espera ao menos um card de conversa na lista.
    const convCards = page.locator('[data-testid^="conv-card-"]');
    await expect(
      convCards.first(),
      'esperava ao menos 1 conversa semeada visível no Inbox da empresa A',
    ).toBeVisible({ timeout: 20_000 });
    expect(await convCards.count()).toBeGreaterThan(0);

    // Filtra pelo canal WhatsApp clicando na aba "WA" (componente Tabs — sem
    // testid dedicado). Best-effort: se a aba não existir, segue sem filtrar
    // (a empresa A só tem WhatsApp semeado de qualquer forma).
    const abaWA = page.getByRole('tab', { name: 'WA' }).or(page.getByText('WA', { exact: true }));
    await abaWA
      .first()
      .click()
      .catch(() => undefined);

    // Após o filtro WhatsApp, ainda deve haver as conversas (são todas WA).
    await expect(convCards.first()).toBeVisible({ timeout: 15_000 });

    // A lista mostra o NOME DO CLIENTE (conv.cliente?.nome ?? peerNome), não o
    // peerNome — então buscamos pelos clientes semeados da empresa A.
    const temMercado = await page
      .getByText('Mercado Bom Preço', { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    const temDistribuidora = await page
      .getByText('Distribuidora Central', { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    expect(
      temMercado || temDistribuidora,
      'esperava ver ao menos um cliente semeado (Mercado Bom Preço ou Distribuidora Central)',
    ).toBe(true);
    await shot(page, 'integracao-inbox-meio');

    // Abre a 1ª conversa e confirma que ela tem mensagens (o thread carrega o
    // histórico semeado: INBOUND "Oi, vocês têm óleo…" + respostas).
    await convCards.first().click();

    // Sinal CONFIÁVEL de que a conversa abriu: o campo de resposta (inbox-compose)
    // aparece — ou o aviso de canal bloqueado. (inbox-thread-peer existe no DOM mas
    // o Playwright não o considera "visível"; não usar como sinal.)
    await expect(
      page.getByTestId('inbox-compose').or(page.getByTestId('inbox-canal-bloqueado')).first(),
      'a conversa deveria abrir (campo de resposta visível)',
    ).toBeVisible({ timeout: 15_000 });

    // Pelo menos uma das frases semeadas deve aparecer no histórico. Conferimos
    // de forma resiliente um trecho curto e estável da 1ª mensagem inbound.
    const temMensagemSemeada = await page
      .getByText(/óleo de soja|prazo de entrega|caixa com 20/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(
      temMensagemSemeada,
      'o thread aberto deveria mostrar ao menos uma mensagem semeada da conversa',
    ).toBe(true);

    // Sem formatação quebrada no Inbox.
    const body = page.locator('body');
    await expect(body).not.toContainText('Invalid Date');
    await expect(body).not.toContainText('NaN');

    await shot(page, 'integracao-inbox-fim');

    // NOTA (registrada no retorno do agente, não falha o teste): NÃO existe
    // endpoint interno pra simular recebimento de mensagem inbound de WhatsApp.
    // O recebimento AO VIVO precisa de teste manual com o WhatsApp real pareado.
  });
});
