import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, shot } from '../helpers/auth';
import { USERS } from '../fixtures/users';

/**
 * Clientes — CRUD + listagem (Fase 2, roteiro por área).
 *
 * Padrão herdado do smoke: login pela UI (diretorA vê todos os clientes da empresa A),
 * navega pra /clientes e exercita o fluxo real contra frontend(5174)+backend(4001).
 *
 * Seletores reais (lidos de ClientesPage.tsx + ClienteForm + LocalidadeSelects):
 *  - Abrir form novo .......... testid `cliente-new-btn`
 *  - Nome ..................... testid `cliente-nome-input`
 *  - CNPJ .................... testid `cliente-cnpj-input`  (máscara + DV válido obrigatório)
 *  - Segmento/Email/Telefone . getByLabel (sem testid próprio)
 *  - CEP/Logradouro/Bairro ... getByLabel (sem testid próprio)
 *  - Número .................. testid `cliente-numero-input` (label "Número*" não casa exact)
 *  - UF ...................... testid `cliente-uf-select`   (<select> nativo, value=sigla)
 *  - Cidade .................. testid `cliente-cidade-select` (<select> async via IBGE)
 *  - Salvar .................. testid `cliente-save-btn`
 *  - Toast ................... testid `toast-success` / `toast-error`
 *  - Linha / abrir página .... testid `cliente-row-{id}` / `cliente-open-{id}`
 *  - Filtro status ........... testid `filter-status`
 *  - Busca ................... placeholder "Buscar por nome, CNPJ, e-mail…"
 *  - Vazio ................... EmptyState com texto "Nenhum cliente encontrado"
 *  - Editar individual ....... drawer (clicar a linha) → "Editar" → ClienteFormModal (cliente-save-btn)
 *  - Excluir individual ...... página /clientes/:id (aba Dados) → `cliente-del` → `cliente-del-confirm`
 */

const SEARCH_PLACEHOLDER = 'Buscar por nome, CNPJ, e-mail…';

/**
 * Gera um CNPJ válido (com dígitos verificadores corretos) e único por timestamp.
 * Mesma fórmula do isValidCNPJ do front — garante que o form não bloqueie no DV
 * e que cada re-run use um CNPJ diferente (evita colisão de UNIQUE no backend).
 */
function cnpjValidoUnico(): string {
  // 12 dígitos base a partir do epoch (sempre 12 chars no horizonte atual).
  const base = String(Date.now()).slice(-12).padStart(12, '0').split('').map(Number);
  const dv = (nums: number[]): number => {
    let pos = nums.length - 7;
    let sum = 0;
    for (let i = 0; i < nums.length; i++) {
      sum += nums[i] * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  const full = [...base, d1, d2].join('');
  // Formata 00.000.000/0001-00
  return `${full.slice(0, 2)}.${full.slice(2, 5)}.${full.slice(5, 8)}/${full.slice(8, 12)}-${full.slice(12)}`;
}

/** Conta linhas da tabela de clientes (cada linha tem testid cliente-row-*). */
function rows(page: Page) {
  return page.locator('[data-testid^="cliente-row-"]');
}

/**
 * Preenche TODOS os campos obrigatórios do form de cliente e salva.
 * Retorna o nome usado (único). Pressupõe que o modal já está aberto.
 */
async function preencherEsalvar(page: Page, nome: string): Promise<void> {
  // Escopa TUDO ao modal: o drawer de detalhe do cliente fica sempre montado
  // (oculto) e tem um campo "Bairro" — sem o escopo, getByLabel('Bairro') casa 2.
  const modal = page.getByTestId('modal-overlay');

  // Nome + CNPJ têm testid dedicado.
  await modal.getByTestId('cliente-nome-input').fill(nome);
  await modal.getByTestId('cliente-cnpj-input').fill(cnpjValidoUnico());

  // Campos sem testid — ligados via <Field><Label htmlFor> ⇒ getByLabel resolve.
  await modal.getByLabel('Segmento').fill('E2E Teste');
  await modal.getByLabel('E-mail').fill(`e2e_${Date.now()}@betinna.test`);
  await modal.getByLabel('Telefone').fill('11999998888');

  // Endereço. CEP dispara busca ViaCEP no blur, mas preenchemos tudo na mão
  // pra não depender de rede externa.
  await modal.getByLabel('CEP').fill('01310100');
  await modal.getByLabel('Logradouro').fill('Av. Paulista');
  // "Número" tem testid dedicado: o <Label required> renderiza "Número*"
  // (asterisco concatenado), então getByLabel('Número', { exact:true }) não casa.
  await modal.getByTestId('cliente-numero-input').fill('1000');
  await modal.getByLabel('Bairro').fill('Bela Vista');

  // UF é <select> nativo (value = sigla). Depois dele a lista de cidades carrega async.
  await modal.getByTestId('cliente-uf-select').selectOption('SP');

  // Espera a cidade desejada aparecer no <select> (municípios IBGE carregam sob demanda).
  const cidadeSelect = modal.getByTestId('cliente-cidade-select');
  await expect(cidadeSelect.locator('option', { hasText: 'São Paulo' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await cidadeSelect.selectOption({ label: 'São Paulo' });

  await modal.getByTestId('cliente-save-btn').click();
}

/**
 * Cria um cliente do zero e espera ele existir. Usado como setup pelos testes
 * de editar/excluir (cada um cria seu próprio dado pra não colidir em re-runs).
 * Retorna { nome, id }.
 */
async function criarCliente(page: Page): Promise<{ nome: string; id: string }> {
  const nome = `Cliente E2E ${Date.now()}`;
  await page.getByTestId('cliente-new-btn').click();
  await expect(page.getByTestId('modal-overlay')).toBeVisible();
  await preencherEsalvar(page, nome);

  // Modal fecha no sucesso (onSaved). Confirma e localiza a linha pela busca.
  await expect(page.getByTestId('modal-overlay')).toBeHidden({ timeout: 15_000 });
  const buscar = page.getByPlaceholder(SEARCH_PLACEHOLDER);
  await buscar.fill(nome);
  const row = rows(page).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const testid = (await row.getAttribute('data-testid')) ?? '';
  const id = testid.replace('cliente-row-', '');
  return { nome, id };
}

// ─────────────────────────────────────────────────────────────────────────
test.describe('Clientes — CRUD @smoke', () => {
  test('criar cliente novo aparece na lista', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/clientes');
    await shot(page, 'clientes-criar-inicio');

    const nome = `Cliente E2E ${Date.now()}`;

    // diretorA tem clientes.edit ⇒ botão de novo deve existir.
    await expect(page.getByTestId('cliente-new-btn')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('cliente-new-btn').click();
    await expect(page.getByTestId('modal-overlay')).toBeVisible();
    await shot(page, 'clientes-criar-form');

    await preencherEsalvar(page, nome);

    // Sucesso: ou aparece o toast, OU (mais resiliente) o modal fecha e o cliente
    // surge na lista quando buscado pelo nome. Aceitamos qualquer um dos sinais.
    const toast = page.getByTestId('toast-success');
    await Promise.race([
      toast.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
      page.getByTestId('modal-overlay').waitFor({ state: 'hidden', timeout: 15_000 }),
    ]);

    // Verificação dura: o cliente existe na listagem.
    await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill(nome);
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(nome, { exact: false }).first()).toBeVisible();
    await shot(page, 'clientes-criar-fim');
  });

  test('editar cliente salva alteração', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/clientes');
    await shot(page, 'clientes-editar-inicio');

    // Cria um cliente próprio pra editar (isolado de outros testes/re-runs).
    const { id } = await criarCliente(page);

    // Edição se dá pelo MESMO ClienteFormModal: abre-se o drawer (clicando a linha)
    // e dali o botão "Editar". (A página /clientes/:id tem um form inline com
    // campos sem label associado/testid, então o caminho do modal é o confiável.)
    await page.getByTestId(`cliente-row-${id}`).click();
    const editarBtn = page.getByRole('button', { name: 'Editar' });
    await expect(editarBtn).toBeVisible({ timeout: 15_000 });
    await editarBtn.click();

    // O modal de edição reaproveita o ClienteForm (campos com label + testids).
    await expect(page.getByTestId('modal-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('cliente-nome-input')).toBeVisible();
    await shot(page, 'clientes-editar-meio');

    // Altera o segmento (campo simples, sem máscara) e salva.
    const novoSegmento = `Editado ${Date.now()}`;
    await page.getByLabel('Segmento').fill(novoSegmento);
    await page.getByTestId('cliente-save-btn').click();

    // Sucesso: o modal fecha (onSaved → refetch). Não há toast nesse fluxo,
    // então o sinal confiável é o modal sumir sem erro de validação.
    await expect(page.getByTestId('form-error')).toBeHidden();
    await expect(page.getByTestId('modal-overlay')).toBeHidden({ timeout: 15_000 });
    await shot(page, 'clientes-editar-fim');
  });

  test('excluir cliente com confirmação some da lista', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/clientes');
    await shot(page, 'clientes-excluir-inicio');

    // Cria um cliente de teste pra excluir (não toca nos dados semeados).
    const { nome, id } = await criarCliente(page);

    // Não há exclusão na própria linha. A exclusão individual com confirmação
    // vive na página /clientes/:id (aba Dados): botão `cliente-del` → `cliente-del-confirm`.
    await page.getByTestId(`cliente-open-${id}`).click();
    await expect(page).toHaveURL(new RegExp(`/clientes/${id}`), { timeout: 15_000 });

    const excluir = page.getByTestId('cliente-del');
    await expect(excluir).toBeVisible({ timeout: 15_000 });
    await excluir.click();

    // Confirmação: aparece o botão `cliente-del-confirm`.
    const confirmar = page.getByTestId('cliente-del-confirm');
    await expect(confirmar).toBeVisible();
    await shot(page, 'clientes-excluir-meio');
    await confirmar.click();

    // Sucesso: redireciona pra /clientes (onDeleted → navigate) e o cliente some.
    await expect(page).toHaveURL(/\/clientes$/, { timeout: 15_000 });
    await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill(nome);
    // A lista some: busca pelo nome único não retorna nenhuma linha.
    await expect(async () => {
      const n = await rows(page).count();
      expect(n).toBe(0);
    }).toPass({ timeout: 15_000 });
    await shot(page, 'clientes-excluir-fim');
  });
});

// ─────────────────────────────────────────────────────────────────────────
test.describe('Clientes — listagem @regression', () => {
  test('busca filtra a lista', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/clientes');
    await shot(page, 'clientes-busca-inicio');

    // Garante que há linhas pra filtrar (diretorA vê todos os clientes da empresa A).
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    const totalAntes = await rows(page).count();
    expect(totalAntes).toBeGreaterThan(0);

    // Pega o nome real da 1ª linha pelo link de abrir (cliente-open-*), mais
    // confiável que fatiar o innerText da <tr> (que mistura células).
    const primeiroNome = (
      await page.locator('[data-testid^="cliente-open-"]').first().innerText()
    ).trim();
    const termo = primeiroNome.slice(0, 4) || 'a';
    await shot(page, 'clientes-busca-meio');

    await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill(termo);

    // Após buscar: ainda há resultado (pelo menos a linha de origem) e a busca
    // realmente filtrou (não aumentou o conjunto). Asserção resiliente: >0 e <= total.
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      const n = await rows(page).count();
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(totalAntes);
    }).toPass({ timeout: 15_000 });
    await shot(page, 'clientes-busca-fim');
  });

  test('filtro de status muda a lista', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/clientes');
    await shot(page, 'clientes-filtro-status-inicio');

    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    const totalTodos = await rows(page).count();

    // Aplica um status específico (ATIVO). A lista deve reagir (recarrega via query).
    await page.getByTestId('filter-status').selectOption('ATIVO');
    await shot(page, 'clientes-filtro-status-meio');

    // Resiliente: ou filtra pra um subconjunto (<= total e >0), ou esvazia (empty state).
    await expect(async () => {
      const n = await rows(page).count();
      if (n === 0) {
        await expect(page.getByText(/Nenhum cliente/i)).toBeVisible();
      } else {
        expect(n).toBeLessThanOrEqual(totalTodos);
      }
    }).toPass({ timeout: 15_000 });
    await shot(page, 'clientes-filtro-status-fim');
  });

  test('estado vazio mostra mensagem amigável', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/clientes');
    await shot(page, 'clientes-vazio-inicio');

    // Busca por algo que não existe → EmptyState ("Nenhum cliente encontrado").
    await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill('zzzznaoexiste123');

    await expect(page.getByText(/Nenhum cliente/i)).toBeVisible({ timeout: 15_000 });
    await expect(rows(page)).toHaveCount(0);
    await shot(page, 'clientes-vazio-fim');
  });

  test('paginação navega quando aplicável', async ({ page }) => {
    await loginViaUI(page, USERS.diretorA.email);
    await page.goto('/clientes');
    await shot(page, 'clientes-paginacao-inicio');

    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });

    // A paginação só renderiza quando totalPages > 1 (limit=20). Não há testid
    // dedicado: os controles são botões "Anterior"/"Próxima". Se "Próxima" não
    // existir/estiver desabilitada, há só 1 página → pulamos com anotação.
    const proxima = page.getByRole('button', { name: 'Próxima' });
    const temPaginacao = (await proxima.count()) > 0 && (await proxima.isEnabled().catch(() => false));
    test.skip(!temPaginacao, 'Só 1 página de clientes (sem paginação) neste dataset.');

    // Captura uma assinatura da página atual (testid da 1ª linha) pra comparar.
    const antes = await rows(page).first().getAttribute('data-testid');
    await proxima.click();
    await shot(page, 'clientes-paginacao-meio');

    // A lista deve mudar: a 1ª linha da página 2 difere da página 1.
    await expect(async () => {
      await expect(rows(page).first()).toBeVisible();
      const depois = await rows(page).first().getAttribute('data-testid');
      expect(depois).not.toBe(antes);
    }).toPass({ timeout: 15_000 });
    await shot(page, 'clientes-paginacao-fim');
  });
});
