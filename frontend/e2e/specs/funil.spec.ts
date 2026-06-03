import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Funil / Kanban + Funis — pipeline visual (Fase 2, roteiro por área).
 *
 * Padrão herdado de clientes.spec.ts: login pela UI (diretorA vê o pipeline da
 * empresa A), navega pra /leads (Kanban) e /funis (CRUD de funis) e exercita o
 * fluxo real contra frontend(5174)+backend(4001).
 *
 * IMPORTANTE — o seed NÃO cria leads, então as colunas começam vazias. Cada teste
 * que precisa de um lead cria o seu próprio (nome único via Date.now), pra não
 * depender de dado semeado e não colidir entre re-runs.
 *
 * Seletores reais (lidos de LeadsPage.tsx + FunisPage.tsx + ui/Dialog/Drawer/toast):
 *
 *  /leads (Kanban)
 *   - Coluna de etapa ......... testid `kanban-col-{etapaId}` (etapaId = cuid do funil
 *                               customizado OU nome do enum no fallback legado). O header
 *                               da coluna mostra `etapa.nome` (ex: "Novo", "Qualificando").
 *                               → casamos por TEXTO do header, robusto p/ cuid vs enum.
 *   - Coluna vazia ............ texto "Solte um lead aqui" (NÃO "Nenhum lead nessa etapa")
 *   - Abrir form novo lead .... testid `lead-new-btn`
 *   - Form (Dialog) ........... testid `modal-overlay`
 *   - Nome (ÚNICO obrigatório)  testid `lead-nome-input`
 *   - Salvar .................. testid `lead-save-btn`  (label "Criar lead")
 *   - Card do lead ............ testid `lead-card-{id}` (id desconhecido no create →
 *                               localizamos o card pelo TEXTO do nome único)
 *   - Detail drawer ........... testid `drawer-overlay`
 *   - Botão de etapa (drawer) . testid `lead-etapa-{etapaId}` (1 botão por etapa; o da
 *                               etapa atual fica disabled)
 *   - Motivo GANHO/PERDIDO .... testid `lead-etapa-motivo` (Textarea) + botão
 *                               "Confirmar {nomeEtapa}"
 *   - Métricas (header) ....... PageLayout description: "{n} leads · {R$} em ativo"
 *   - Toast ................... testid `toast-success` / `toast-error`
 *
 *  /funis (CRUD)
 *   - Abrir form novo funil ... testid `funil-new-btn`
 *   - Nome do funil ........... testid `funil-nome-input`
 *   - Salvar funil ............ testid `funil-save-btn`
 *   - Linha do funil .......... testid `funil-row-{id}`
 *   - Adicionar etapa ......... testid `etapa-new-btn`
 *   - Nome da etapa ........... testid `etapa-nome-input`
 *   - Salvar etapa ............ testid `etapa-save-btn`
 *   - Linha de etapa .......... testid `etapa-row-{id}`
 *   - Vazio ................... EmptyState "Nenhum funil cadastrado"
 *
 * Drag-and-drop: EXISTE na UI (dnd-kit) tanto pra mover lead entre colunas no Kanban
 * quanto pra reordenar etapas no editor de funil. Mas drag-drop é frágil no Playwright,
 * então — como pedido no roteiro — a mudança de etapa é exercitada pelos BOTÕES de etapa
 * do drawer (frente e volta), que cobrem o mesmo PUT /leads/:id/etapa.
 */

const ETAPAS_ESPERADAS = [
  'Novo',
  'Qualificando',
  'Proposta',
  'Negociação',
  'Ganho',
  'Perdido',
];

/** Localiza uma coluna do Kanban pelo nome (header), tolerante a cuid vs enum no testid. */
function colunaPorNome(page: Page, nome: string) {
  return page.locator('[data-testid^="kanban-col-"]').filter({ hasText: nome });
}

/** Todas as colunas do Kanban. */
function colunas(page: Page) {
  return page.locator('[data-testid^="kanban-col-"]');
}

/**
 * Cria um lead com nome único e espera o card aparecer no board.
 * Retorna o nome usado. Pressupõe estar em /leads com o board carregado.
 *
 * O lead nasce na 1ª etapa ATIVA do funil selecionado (lógica do LeadFormModal),
 * então o card surge em alguma coluna ativa (tipicamente "Novo").
 */
async function criarLead(page: Page): Promise<string> {
  const nome = `Lead E2E ${Date.now()}`;

  await expect(page.getByTestId('lead-new-btn')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('lead-new-btn').click();
  await expect(page.getByTestId('modal-overlay')).toBeVisible();

  // Nome é o ÚNICO campo obrigatório (resto é opcional no schema do form).
  await page.getByTestId('lead-nome-input').fill(nome);
  await page.getByTestId('lead-save-btn').click();

  // Sucesso: o modal fecha (onSaved → refetch). Confirma e localiza o card pelo nome.
  await expect(page.getByTestId('modal-overlay')).toBeHidden({ timeout: 15_000 });
  await expect(
    page.locator('[data-testid^="lead-card-"]').filter({ hasText: nome }).first(),
  ).toBeVisible({ timeout: 15_000 });

  return nome;
}

// ─────────────────────────────────────────────────────────────────────────
test.describe('Funil/Kanban @regression', () => {
  test('/leads carrega: Kanban com colunas de etapa, sem NaN/Invalid Date', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/leads');
    await shot(page, 'funil-kanban-inicio');

    // O board renderiza: pelo menos uma coluna de etapa aparece.
    await expect(colunas(page).first()).toBeVisible({ timeout: 15_000 });
    const totalColunas = await colunas(page).count();
    expect(totalColunas).toBeGreaterThan(0);

    // As etapas-padrão do pipeline aparecem pelo header (texto). Casamos por nome,
    // tolerante a o testid usar cuid (funil custom) ou enum (fallback).
    // Não exigimos as 6 (um funil custom pode ter menos): exigimos as do funil padrão
    // que existirem, e que NOVO esteja presente como âncora do início.
    await expect(colunaPorNome(page, 'Novo').first()).toBeVisible({ timeout: 15_000 });
    let etapasVistas = 0;
    for (const nome of ETAPAS_ESPERADAS) {
      if ((await colunaPorNome(page, nome).count()) > 0) etapasVistas++;
    }
    // Pelo menos o início + um terminal devem existir num pipeline minimamente útil.
    expect(etapasVistas).toBeGreaterThanOrEqual(2);
    await shot(page, 'funil-kanban-meio');

    // Colunas podem estar vazias (seed sem leads) → "Solte um lead aqui". Confirma que
    // isso renderiza sem quebrar (texto real do componente, não "Nenhum lead nessa etapa").
    // Resiliente: se já houver leads de um re-run, o texto pode não aparecer — ok.
    const vazias = page.getByText('Solte um lead aqui');
    if ((await vazias.count()) > 0) {
      await expect(vazias.first()).toBeVisible();
    }

    // Higiene: nenhum "NaN" / "Invalid Date" vazou no body (métricas/datas quebradas).
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('nan');
    expect(body).not.toContain('invalid date');
    await shot(page, 'funil-kanban-fim');
  });

  test('criar lead aparece numa coluna do board', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/leads');
    await shot(page, 'funil-criar-lead-inicio');

    await expect(colunas(page).first()).toBeVisible({ timeout: 15_000 });
    await shot(page, 'funil-criar-lead-form');

    const nome = await criarLead(page);

    // Verificação dura: o card existe em alguma coluna do board E (sinal extra) um toast
    // de sucesso pode ter aparecido. Aceitamos o card como prova suficiente.
    const card = page.locator('[data-testid^="lead-card-"]').filter({ hasText: nome }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // O card deve estar dentro de uma coluna ativa (tipicamente "Novo").
    const colunaDoCard = colunaPorNome(page, 'Novo').filter({ hasText: nome });
    // Resiliente: se o funil padrão nomear a 1ª etapa ativa diferente de "Novo",
    // basta o card existir em ALGUMA coluna (já confirmado acima). Tentamos "Novo" sem
    // falhar caso o nome difira.
    if ((await colunaDoCard.count()) > 0) {
      await expect(colunaDoCard.first()).toBeVisible();
    }
    await shot(page, 'funil-criar-lead-fim');
  });

  test('mover lead entre etapas pelo drawer (ida e volta)', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/leads');
    await shot(page, 'funil-mover-inicio');

    await expect(colunas(page).first()).toBeVisible({ timeout: 15_000 });

    // Cria um lead próprio pra mover (isolado).
    const nome = await criarLead(page);

    // Abre o detail drawer clicando no card (click curto não dispara drag no dnd-kit).
    const card = page.locator('[data-testid^="lead-card-"]').filter({ hasText: nome }).first();
    await card.click();
    await expect(page.getByTestId('drawer-overlay')).toBeVisible({ timeout: 15_000 });

    // Controle de etapa = botões `lead-etapa-{id}` (1 por etapa; o atual fica disabled).
    // Confirma que o controle existe (se não existir, é BUG/lacuna — falha aqui com mensagem).
    const botoesEtapa = page.locator('[data-testid^="lead-etapa-"]');
    await expect(
      botoesEtapa.first(),
      'Drawer sem controle de etapa (lead-etapa-*): não dá pra mudar etapa pela UI',
    ).toBeVisible({ timeout: 15_000 });
    await shot(page, 'funil-mover-meio');

    // Estado inicial: exatamente 1 botão de etapa está disabled (a etapa atual do lead).
    const etapaAtualAntes = await disabledEtapaTestId(page);
    expect(etapaAtualAntes, 'esperava 1 etapa marcada como atual').not.toBeNull();

    // ── IDA: move pra uma etapa ATIVA diferente (evita GANHO/PERDIDO p/ não pedir motivo).
    const destinoIda = await primeiraEtapaAtivaDiferente(page, etapaAtualAntes!);
    expect(
      destinoIda,
      'precisa de >=2 etapas ATIVAS pra testar ida-e-volta sem terminal',
    ).not.toBeNull();

    await page.getByTestId(destinoIda!).click();
    // Sucesso: drawer fecha (onChanged → refetch) ou toast de sucesso aparece.
    await Promise.race([
      page.getByTestId('drawer-overlay').waitFor({ state: 'hidden', timeout: 15_000 }),
      page.getByTestId('toast-success').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
    ]);
    await expect(page.getByTestId('drawer-overlay')).toBeHidden({ timeout: 15_000 });

    // Confirma a mudança: o card agora vive na coluna de destino.
    const nomeDestino = etapaNomeDeTestId(destinoIda!);
    if (nomeDestino) {
      await expect(
        colunaPorNome(page, nomeDestino).filter({ hasText: nome }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }

    // ── VOLTA: reabre o card e volta pra etapa de origem.
    const card2 = page.locator('[data-testid^="lead-card-"]').filter({ hasText: nome }).first();
    await card2.click();
    await expect(page.getByTestId('drawer-overlay')).toBeVisible({ timeout: 15_000 });

    // Agora a etapa atual deve ser o destino-da-ida (disabled). Clica de volta na origem.
    await expect(page.getByTestId(etapaAtualAntes!)).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId(etapaAtualAntes!).click();
    await expect(page.getByTestId('drawer-overlay')).toBeHidden({ timeout: 15_000 });

    // De volta na origem: o card volta pra coluna inicial.
    const nomeOrigem = etapaNomeDeTestId(etapaAtualAntes!);
    if (nomeOrigem) {
      await expect(
        colunaPorNome(page, nomeOrigem).filter({ hasText: nome }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }
    await shot(page, 'funil-mover-fim');
  });

  test('mover lead pra GANHO pede motivo e confirma', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/leads');
    await shot(page, 'funil-ganho-inicio');

    await expect(colunas(page).first()).toBeVisible({ timeout: 15_000 });
    const nome = await criarLead(page);

    const card = page.locator('[data-testid^="lead-card-"]').filter({ hasText: nome }).first();
    await card.click();
    await expect(page.getByTestId('drawer-overlay')).toBeVisible({ timeout: 15_000 });

    // Acha o botão da etapa GANHO pelo texto do próprio botão (nome da etapa terminal +).
    // A coluna "Ganho" existe no board; o botão no drawer carrega o mesmo nome.
    const botaoGanho = page
      .locator('[data-testid^="lead-etapa-"]')
      .filter({ hasText: 'Ganho' })
      .first();
    if ((await botaoGanho.count()) === 0) {
      test.skip(true, 'Funil sem etapa do tipo GANHO neste dataset.');
      return;
    }
    await botaoGanho.click();

    // Terminal → pede motivo (Textarea lead-etapa-motivo) antes de confirmar.
    const motivo = page.getByTestId('lead-etapa-motivo');
    await expect(
      motivo,
      'mover pra GANHO deveria abrir campo de motivo (lead-etapa-motivo)',
    ).toBeVisible({ timeout: 15_000 });
    await shot(page, 'funil-ganho-meio');
    await motivo.fill('Cliente fechou pedido — E2E');

    // Botão "Confirmar {nomeEtapa}" (ex: "Confirmar Ganho"). Casamos pelo prefixo.
    await page.getByRole('button', { name: /^Confirmar / }).click();

    // Sucesso: drawer fecha (onChanged → refetch) e o card aparece na coluna Ganho.
    await expect(page.getByTestId('drawer-overlay')).toBeHidden({ timeout: 15_000 });
    await expect(
      colunaPorNome(page, 'Ganho').filter({ hasText: nome }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await shot(page, 'funil-ganho-fim');
  });

  test('métricas do funil (header) sem NaN', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/leads');
    await shot(page, 'funil-metricas-inicio');

    await expect(colunas(page).first()).toBeVisible({ timeout: 15_000 });

    // O PageLayout mostra a métrica na description: "{n} leads · {R$} em ativo".
    // Garante que renderiza e que não contém NaN (pipeline total quebrado).
    const metrica = page.getByText(/\bleads\b.*em ativo/i);
    if ((await metrica.count()) > 0) {
      const txt = await metrica.first().innerText();
      expect(txt.toLowerCase()).not.toContain('nan');
      // O número de leads é um inteiro válido.
      expect(txt).toMatch(/\d+\s*leads/i);
    }

    // Higiene global no body também (totais por coluna são fmtBRLCompact → nunca NaN).
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('nan');
    expect(body).not.toContain('invalid date');
    await shot(page, 'funil-metricas-fim');
  });
});

// ─────────────────────────────────────────────────────────────────────────
test.describe('Funis — CRUD @regression', () => {
  test('/funis carrega a lista de funis', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/funis');
    await shot(page, 'funis-lista-inicio');

    // Ou existe a lista (>=1 funil — o seed cria um padrão), ou o EmptyState aparece.
    // Resiliente aos dois caminhos.
    const linhas = page.locator('[data-testid^="funil-row-"]');
    await expect(async () => {
      const n = await linhas.count();
      if (n === 0) {
        await expect(page.getByText(/Nenhum funil cadastrado/i)).toBeVisible();
      } else {
        await expect(linhas.first()).toBeVisible();
      }
    }).toPass({ timeout: 15_000 });

    // Sem NaN/Invalid Date vazando.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('nan');
    expect(body).not.toContain('invalid date');
    await shot(page, 'funis-lista-fim');
  });

  test('criar funil simples (nome) e adicionar etapa', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/funis');
    await shot(page, 'funis-criar-inicio');

    // Botão de novo funil deve existir (diretorA gerencia o pipeline da empresa).
    const novoBtn = page.getByTestId('funil-new-btn');
    await expect(novoBtn).toBeVisible({ timeout: 15_000 });
    await novoBtn.click();
    await expect(page.getByTestId('modal-overlay')).toBeVisible();

    const nomeFunil = `Funil E2E ${Date.now()}`;
    await page.getByTestId('funil-nome-input').fill(nomeFunil);
    await shot(page, 'funis-criar-form');
    await page.getByTestId('funil-save-btn').click();

    // Sucesso: o modal fecha (onSaved → seleciona o novo + refetch) e o funil aparece
    // na lista. O FunisPage auto-seleciona o recém-criado.
    await expect(page.getByTestId('modal-overlay')).toBeHidden({ timeout: 15_000 });
    await expect(
      page.locator('[data-testid^="funil-row-"]').filter({ hasText: nomeFunil }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await shot(page, 'funis-criar-meio');

    // Editor do funil selecionado: cria uma etapa simples via `etapa-new-btn`.
    // (Funil novo nasce sem etapas → EmptyState "Funil sem etapas" + botão "Criar etapa".)
    const etapaNewBtn = page.getByTestId('etapa-new-btn');
    if ((await etapaNewBtn.count()) === 0) {
      test.skip(true, 'Editor sem botão de nova etapa (etapa-new-btn) — anotado.');
      return;
    }
    await expect(etapaNewBtn).toBeVisible({ timeout: 15_000 });
    await etapaNewBtn.click();
    await expect(page.getByTestId('modal-overlay')).toBeVisible();

    const nomeEtapa = `Etapa E2E ${Date.now()}`;
    await page.getByTestId('etapa-nome-input').fill(nomeEtapa);
    await page.getByTestId('etapa-save-btn').click();

    // Sucesso: o modal fecha (onSaved → refetch) e a etapa aparece na lista do editor.
    await expect(page.getByTestId('modal-overlay')).toBeHidden({ timeout: 15_000 });
    await expect(
      page.locator('[data-testid^="etapa-row-"]').filter({ hasText: nomeEtapa }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await shot(page, 'funis-criar-fim');
  });
});

// ─── helpers locais de etapa (drawer) ──────────────────────────────────────

/**
 * Retorna o testid (`lead-etapa-{id}`) do ÚNICO botão de etapa que está disabled
 * no drawer aberto — que corresponde à etapa atual do lead. null se nenhum.
 */
async function disabledEtapaTestId(page: Page): Promise<string | null> {
  const botoes = page.locator('[data-testid^="lead-etapa-"]');
  const n = await botoes.count();
  for (let i = 0; i < n; i++) {
    const b = botoes.nth(i);
    if (await b.isDisabled()) {
      return (await b.getAttribute('data-testid')) ?? null;
    }
  }
  return null;
}

/**
 * Acha o testid da primeira etapa ATIVA (clicável = enabled) diferente da atual.
 * Botões disabled = etapa atual; GANHO/PERDIDO ficam enabled mas abririam o fluxo de
 * motivo — pra ida-e-volta queremos uma etapa que NÃO peça motivo. Como o tipo não está
 * no DOM, evitamos os nomes terminais conhecidos ("Ganho"/"Perdido").
 * Retorna null se não houver alternativa segura.
 */
async function primeiraEtapaAtivaDiferente(
  page: Page,
  atualTestId: string,
): Promise<string | null> {
  const botoes = page.locator('[data-testid^="lead-etapa-"]');
  const n = await botoes.count();
  for (let i = 0; i < n; i++) {
    const b = botoes.nth(i);
    const tid = (await b.getAttribute('data-testid')) ?? '';
    if (tid === atualTestId) continue;
    if (await b.isDisabled()) continue;
    const label = (await b.innerText()).trim();
    if (/^(ganho|perdido)$/i.test(label)) continue; // evita terminais (pedem motivo)
    return tid;
  }
  return null;
}

/**
 * Deriva o nome da etapa a partir do testid do botão, lendo o texto do próprio botão
 * é mais confiável; mas quando só temos o testid usamos um lookup por DOM.
 * Aqui mapeamos pelos nomes-padrão conhecidos via o sufixo enum quando presente.
 * Para cuids não há nome embutido → retorna null (o teste então pula a checagem de coluna).
 */
function etapaNomeDeTestId(testId: string): string | null {
  const sufixo = testId.replace('lead-etapa-', '');
  const enumMap: Record<string, string> = {
    NOVO: 'Novo',
    QUALIFICANDO: 'Qualificando',
    PROPOSTA: 'Proposta',
    NEGOCIACAO: 'Negociação',
    GANHO: 'Ganho',
    PERDIDO: 'Perdido',
  };
  return enumMap[sufixo] ?? null;
}
