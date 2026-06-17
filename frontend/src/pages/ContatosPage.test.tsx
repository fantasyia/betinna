/**
 * Testes de ContatosPage — contrato de payloads das ações em lote + lógica de seleção.
 *
 * Cobertura:
 *  1. Seleção: checkbox de linha → barra flutuante com contagem certa
 *  2. Seleção: checkbox do header (selecionar todos da página)
 *  3. Seleção: limpar seleção zera a barra
 *  4. Habilitação: "Mover etapa" desabilitado quando nLeads=0
 *  5. Habilitação: "Adicionar ao funil" desabilitado quando semLead vazio
 *  6. Payload BulkTag: api.post com acao:'tag', leadIds, clienteIds, conversaIds:[], tagIds, modo
 *  7. Payload BulkMove: api.post com acao:'mover-etapa', leadIds, funilEtapaId, motivo
 *  8. Payload BulkMove: motivo obrigatório em etapa GANHO/PERDIDO (toast error, sem post)
 *  9. Payload BulkAddFunil: api.post /contatos/criar-leads com contatos sem lead
 * 10. Payload BulkDelete: api.post com acao:'excluir', leadIds/clienteIds/conversaIds
 * 11. Importar: botão Importar → dialog escolha → leads abre ImportLeadsModal
 * 12. Importar: botão Importar → dialog escolha → clientes abre ImportClientesModal
 */

import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

// ─── mocks de dependências externas ────────────────────────────────────────────

// react-router-dom: useNavigate
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useLocation: () => ({ pathname: '/contatos' }),
}));

// useDebouncedValue: retorna o valor imediatamente (sem delay pra teste)
vi.mock('@/hooks/useDebouncedValue', () => ({
  useDebouncedValue: (v: string) => v,
}));

// usePermission: sempre true pra renderizar checkboxes e bulk bar
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
  useRole: () => 'ADMIN',
  hasPermission: () => true,
}));

// useApiQuery: rota-dependente
const TAGS = [
  { id: 'tag-1', nome: 'VIP', cor: '#ff0000' },
  { id: 'tag-2', nome: 'Novo', cor: '#00ff00' },
];

const FUNIS = [
  {
    id: 'funil-1',
    nome: 'Funil Principal',
    isPadrao: true,
    ativo: true,
    etapas: [
      { id: 'etapa-ativa', nome: 'Qualificando', tipo: 'ATIVA' },
      { id: 'etapa-ganho', nome: 'Ganho', tipo: 'GANHO' },
      { id: 'etapa-perdido', nome: 'Perdido', tipo: 'PERDIDO' },
    ],
  },
];

// contatos representativos:
//  - c1: LEAD com leadId e clienteId → leadIds, clienteIds
//  - c2: LEAD com leadId mas sem clienteId → leadIds
//  - c3: CLIENTE sem leadId → clienteIds, SEM lead (candidato a "add-funil")
//  - c4: CONVERSA sem leadId/clienteId → conversaIds, SEM lead
const CONTATOS = [
  {
    chave: 'chave-c1',
    nome: 'Alice',
    telefone: '11999990001',
    email: null,
    cidade: 'SP',
    uf: 'SP',
    tipos: ['LEAD', 'CLIENTE'] as const,
    representante: null,
    leadId: 'lead-1',
    leadEtapa: 'QUALIFICANDO',
    clienteId: 'cli-1',
    clienteStatus: 'ATIVO',
    clienteOmieStatus: null,
    conversaId: null,
    canal: null,
    ultimaInteracaoEm: null,
    criadoEm: '2024-01-01',
  },
  {
    chave: 'chave-c2',
    nome: 'Bruno',
    telefone: '11999990002',
    email: null,
    cidade: null,
    uf: null,
    tipos: ['LEAD'] as const,
    representante: null,
    leadId: 'lead-2',
    leadEtapa: 'NOVO',
    clienteId: null,
    clienteStatus: null,
    clienteOmieStatus: null,
    conversaId: null,
    canal: null,
    ultimaInteracaoEm: null,
    criadoEm: '2024-01-02',
  },
  {
    chave: 'chave-c3',
    nome: 'Carla',
    telefone: '11999990003',
    email: 'carla@ex.com',
    cidade: 'RJ',
    uf: 'RJ',
    tipos: ['CLIENTE'] as const,
    representante: { id: 'rep-1', nome: 'João' },
    leadId: null,
    leadEtapa: null,
    clienteId: 'cli-3',
    clienteStatus: 'ATIVO',
    clienteOmieStatus: null,
    conversaId: null,
    canal: null,
    ultimaInteracaoEm: null,
    criadoEm: '2024-01-03',
  },
  {
    chave: 'chave-c4',
    nome: 'Diego',
    telefone: '11999990004',
    email: null,
    cidade: null,
    uf: null,
    tipos: ['CONVERSA'] as const,
    representante: null,
    leadId: null,
    leadEtapa: null,
    clienteId: null,
    clienteStatus: null,
    clienteOmieStatus: null,
    conversaId: 'conv-4',
    canal: 'WHATSAPP',
    ultimaInteracaoEm: null,
    criadoEm: '2024-01-04',
  },
];

const CONTATOS_RESP = {
  data: CONTATOS,
  pagination: { page: 1, limit: 30, total: 4, totalPages: 1 },
};

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    if (path === null) return { data: null, loading: false, error: null, refetch: vi.fn() };
    if (path?.startsWith('/contatos'))
      return { data: CONTATOS_RESP, loading: false, error: null, refetch: vi.fn() };
    if (path === '/tags') return { data: TAGS, loading: false, error: null, refetch: vi.fn() };
    if (path === '/funis') return { data: FUNIS, loading: false, error: null, refetch: vi.fn() };
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  },
}));

vi.mock('@/components/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({ afetados: 2, falhas: [] })),
    put: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  ApiError: class extends Error {},
}));

// Stubs de componentes pesados que trazem dependências desnecessárias
vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div data-testid="page-layout">
      {actions && <div data-testid="page-actions">{actions}</div>}
      {children}
    </div>
  ),
  useIsMobile: () => false,
}));

vi.mock('@/components/CrmTabs', () => ({
  CrmTabs: () => <nav data-testid="crm-tabs" />,
}));

vi.mock('@/components/ImportLeadsModal', () => ({
  ImportLeadsModal: ({ onClose }: { funis: unknown[]; onClose: () => void; onDone: () => void }) => (
    <div data-testid="import-leads-modal">
      <button type="button" onClick={onClose}>
        Fechar leads
      </button>
    </div>
  ),
}));

vi.mock('@/components/ImportClientesModal', () => ({
  ImportClientesModal: ({ onClose }: { onClose: () => void; onDone: () => void }) => (
    <div data-testid="import-clientes-modal">
      <button type="button" onClick={onClose}>
        Fechar clientes
      </button>
    </div>
  ),
}));

// masks: evitar falha em isomorphic na formatação
vi.mock('@/lib/masks', () => ({
  formatNumero: (n: number) => String(n),
  maskTelefone: (t: string) => t,
}));

// ─── importar componente DEPOIS dos mocks ──────────────────────────────────────
import ContatosPage from './ContatosPage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Clica no checkbox de uma linha da tabela pelo índice (0-based) */
function clickRowCheckbox(index: number) {
  const rows = screen.getAllByTestId('contato-row');
  const row = rows[index];
  // o checkbox fica na td anterior ao contato-row; para alcançá-lo,
  // buscamos o input dentro da célula irmã (a linha tem o td com o checkbox)
  // Obtemos a linha inteira (tr) e procuramos o input[type=checkbox]
  const tr = row.closest('tr') ?? row.parentElement;
  const cb = tr?.querySelector('input[type=checkbox]') as HTMLInputElement | null;
  if (!cb) throw new Error(`Checkbox não encontrado na linha ${index}`);
  fireEvent.click(cb);
}

/** Clica no checkbox do header (selecionar todos) */
function clickHeaderCheckbox() {
  const headerCb = screen
    .getAllByRole('checkbox')
    .find((el) => (el as HTMLInputElement).getAttribute('aria-label') === 'Selecionar todos da página') as HTMLInputElement | undefined;
  if (!headerCb) throw new Error('Checkbox do header não encontrado');
  fireEvent.click(headerCb);
}

/** Retorna a barra bulk (ou null se não existir) */
function getBulkBar() {
  // A barra contém o texto "selecionado(s)"
  return screen.queryByText(/selecionado/i)?.closest('div') ?? null;
}

// ─── 1. Seleção individual ────────────────────────────────────────────────────

describe('seleção individual', () => {
  it('clicar no checkbox de uma linha exibe a barra flutuante com contagem 1', () => {
    render(<ContatosPage />);
    clickRowCheckbox(0); // Alice
    const bar = getBulkBar();
    expect(bar).toBeTruthy();
    expect(bar?.textContent).toContain('1');
  });

  it('selecionar duas linhas exibe contagem 2', () => {
    render(<ContatosPage />);
    clickRowCheckbox(0);
    clickRowCheckbox(1);
    const bar = getBulkBar();
    expect(bar?.textContent).toContain('2');
  });

  it('desselecionar (clicar novamente) diminui contagem', () => {
    render(<ContatosPage />);
    clickRowCheckbox(0);
    clickRowCheckbox(1);
    clickRowCheckbox(0); // remove Alice
    const bar = getBulkBar();
    expect(bar?.textContent).toContain('1');
  });
});

// ─── 2. Selecionar todos (header checkbox) ───────────────────────────────────

describe('selecionar todos da página', () => {
  it('checkbox do header seleciona todos (4 contatos)', () => {
    render(<ContatosPage />);
    clickHeaderCheckbox();
    const bar = getBulkBar();
    expect(bar).toBeTruthy();
    expect(bar?.textContent).toContain('4');
  });

  it('checkbox do header com todos selecionados desseleciona todos', () => {
    render(<ContatosPage />);
    clickHeaderCheckbox(); // seleciona todos
    clickHeaderCheckbox(); // deseleciona todos
    expect(getBulkBar()).toBeNull();
  });
});

// ─── 3. Limpar seleção ───────────────────────────────────────────────────────

describe('limpar seleção', () => {
  it('botão X na barra flutuante limpa a seleção', () => {
    render(<ContatosPage />);
    clickRowCheckbox(0);
    expect(getBulkBar()).toBeTruthy();
    // botão X tem aria-label "Limpar seleção"
    const clearBtn = screen.getByLabelText('Limpar seleção');
    fireEvent.click(clearBtn);
    expect(getBulkBar()).toBeNull();
  });
});

// ─── 4. Habilitação: Mover etapa ────────────────────────────────────────────

describe('habilitação do botão Mover etapa', () => {
  it('desabilitado quando todos os selecionados não são leads (c3=CLIENTE sem lead, c4=CONVERSA)', () => {
    render(<ContatosPage />);
    // Seleciona Carla (c3: CLIENTE sem leadId) e Diego (c4: CONVERSA sem leadId)
    clickRowCheckbox(2);
    clickRowCheckbox(3);
    const btn = screen.getByText('Mover etapa').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('habilitado quando pelo menos um selecionado é lead', () => {
    render(<ContatosPage />);
    clickRowCheckbox(0); // Alice: LEAD+CLIENTE
    const btn = screen.getByText('Mover etapa').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

// ─── 5. Habilitação: Adicionar ao funil ─────────────────────────────────────

describe('habilitação do botão Adicionar ao funil', () => {
  it('desabilitado quando todos os selecionados já têm lead (c1 e c2 têm leadId)', () => {
    render(<ContatosPage />);
    clickRowCheckbox(0); // Alice: leadId=lead-1
    clickRowCheckbox(1); // Bruno: leadId=lead-2
    const btn = screen.getByText('Adicionar ao funil').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('habilitado quando pelo menos um selecionado não tem lead (c3 sem leadId)', () => {
    render(<ContatosPage />);
    clickRowCheckbox(2); // Carla: CLIENTE sem leadId
    const btn = screen.getByText('Adicionar ao funil').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

// ─── 6. Payload BulkTag ──────────────────────────────────────────────────────

describe('BulkTag — payload de api.post', () => {
  beforeEach(() => {
    render(<ContatosPage />);
    // Seleciona Alice (lead-1, cli-1) e Bruno (lead-2)
    clickRowCheckbox(0);
    clickRowCheckbox(1);
    // Abre o modal de tag
    fireEvent.click(screen.getByText('Tag').closest('button')!);
  });

  it('submete com modo:adicionar e tagIds correta', async () => {
    const { api } = await import('@/lib/api');
    // Clica na tag VIP
    fireEvent.click(screen.getByText('VIP'));
    // Clica em Aplicar
    fireEvent.click(screen.getByText('Aplicar'));
    await Promise.resolve();
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/contatos/acao-massa', {
      acao: 'tag',
      leadIds: ['lead-1', 'lead-2'],
      clienteIds: ['cli-1'],
      conversaIds: [],
      tagIds: ['tag-1'],
      modo: 'adicionar',
    });
  });

  it('submete com modo:remover ao trocar o select', async () => {
    const { api } = await import('@/lib/api');
    const dialog = screen.getByRole('dialog');
    // Clica na tag Novo (dentro do dialog pra não colidir com o badge da linha)
    fireEvent.click(within(dialog).getByText('Novo'));
    // Muda modo para remover
    const modoSelect = within(dialog).getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(modoSelect, { target: { value: 'remover' } });
    // Clica em Aplicar
    fireEvent.click(screen.getByText('Aplicar'));
    await Promise.resolve();
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/contatos/acao-massa', {
      acao: 'tag',
      leadIds: ['lead-1', 'lead-2'],
      clienteIds: ['cli-1'],
      conversaIds: [],
      tagIds: ['tag-2'],
      modo: 'remover',
    });
  });
});

// ─── 7. Payload BulkMove ─────────────────────────────────────────────────────

describe('BulkMove — payload de api.post', () => {
  beforeEach(() => {
    render(<ContatosPage />);
    // Seleciona Alice (lead-1) e Bruno (lead-2)
    clickRowCheckbox(0);
    clickRowCheckbox(1);
    // Abre o modal de mover
    fireEvent.click(screen.getByText('Mover etapa').closest('button')!);
  });

  it('submete com acao:mover-etapa, leadIds e funilEtapaId (etapa ATIVA sem motivo)', async () => {
    const { api } = await import('@/lib/api');
    const dialog = screen.getByRole('dialog');
    // Seleciona o funil
    const [funilSel, etapaSel] = within(dialog).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(funilSel, { target: { value: 'funil-1' } });
    // Seleciona etapa ATIVA (Qualificando)
    fireEvent.change(etapaSel, { target: { value: 'etapa-ativa' } });
    // Clica em Mover
    fireEvent.click(within(dialog).getByText('Mover'));
    await Promise.resolve();
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/contatos/acao-massa', {
      acao: 'mover-etapa',
      leadIds: ['lead-1', 'lead-2'],
      clienteIds: [],
      conversaIds: [],
      funilEtapaId: 'etapa-ativa',
      motivo: undefined,
    });
  });

  it('bloqueia submit (toast error, sem api.post) se etapa GANHO sem motivo', async () => {
    const { api } = await import('@/lib/api');
    const dialog = screen.getByRole('dialog');
    const [funilSel, etapaSel] = within(dialog).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(funilSel, { target: { value: 'funil-1' } });
    fireEvent.change(etapaSel, { target: { value: 'etapa-ganho' } });
    // NÃO preenche motivo → clica Mover
    fireEvent.click(within(dialog).getByText('Mover'));
    await Promise.resolve();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('submete com motivo quando etapa é GANHO e motivo preenchido', async () => {
    const { api } = await import('@/lib/api');
    const dialog = screen.getByRole('dialog');
    const [funilSel, etapaSel] = within(dialog).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(funilSel, { target: { value: 'funil-1' } });
    fireEvent.change(etapaSel, { target: { value: 'etapa-ganho' } });
    // Preenche motivo
    const motivoInput = within(dialog).getByPlaceholderText(/fechou neg/i) as HTMLInputElement;
    fireEvent.change(motivoInput, { target: { value: 'Fechou contrato' } });
    fireEvent.click(within(dialog).getByText('Mover'));
    await Promise.resolve();
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/contatos/acao-massa', {
      acao: 'mover-etapa',
      leadIds: ['lead-1', 'lead-2'],
      clienteIds: [],
      conversaIds: [],
      funilEtapaId: 'etapa-ganho',
      motivo: 'Fechou contrato',
    });
  });
});

// ─── 9. Payload BulkAddFunil ─────────────────────────────────────────────────

describe('BulkAddFunil — payload de api.post /contatos/criar-leads', () => {
  it('submete contatos SEM lead (c3 e c4) com funilId/funilEtapaId opcionals', async () => {
    const { api } = await import('@/lib/api');
    render(<ContatosPage />);
    // Seleciona Carla (cli-3, sem lead) e Diego (conv-4, sem lead)
    clickRowCheckbox(2);
    clickRowCheckbox(3);
    // Abre o modal de adicionar ao funil
    fireEvent.click(screen.getByText('Adicionar ao funil').closest('button')!);
    const dialog = screen.getByRole('dialog');
    // Deixa sem selecionar funil/etapa → funil padrão
    fireEvent.click(within(dialog).getByText('Adicionar'));
    await Promise.resolve();
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/contatos/criar-leads', {
      funilId: undefined,
      funilEtapaId: undefined,
      contatos: [
        {
          nome: 'Carla',
          telefone: '11999990003',
          email: 'carla@ex.com',
          cidade: 'RJ',
          uf: 'RJ',
          representanteId: 'rep-1',
        },
        {
          nome: 'Diego',
          telefone: '11999990004',
          email: undefined,
          cidade: undefined,
          uf: undefined,
          representanteId: undefined,
        },
      ],
    });
  });

  it('submete com funilId e funilEtapaId quando selecionados', async () => {
    const { api } = await import('@/lib/api');
    render(<ContatosPage />);
    clickRowCheckbox(2); // Carla sem lead
    fireEvent.click(screen.getByText('Adicionar ao funil').closest('button')!);
    const dialog = screen.getByRole('dialog');
    const selects = within(dialog).getAllByRole('combobox') as HTMLSelectElement[];
    // Seleciona funil
    fireEvent.change(selects[0], { target: { value: 'funil-1' } });
    // Seleciona etapa
    fireEvent.change(selects[1], { target: { value: 'etapa-ativa' } });
    fireEvent.click(within(dialog).getByText('Adicionar'));
    await Promise.resolve();
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/contatos/criar-leads', {
      funilId: 'funil-1',
      funilEtapaId: 'etapa-ativa',
      contatos: [
        {
          nome: 'Carla',
          telefone: '11999990003',
          email: 'carla@ex.com',
          cidade: 'RJ',
          uf: 'RJ',
          representanteId: 'rep-1',
        },
      ],
    });
  });
});

// ─── 10. Payload BulkDelete ──────────────────────────────────────────────────

describe('BulkDelete — payload de api.post', () => {
  it('submete com acao:excluir e todos os ids (leadIds, clienteIds, conversaIds)', async () => {
    const { api } = await import('@/lib/api');
    render(<ContatosPage />);
    // Seleciona todos os 4 contatos
    clickHeaderCheckbox();
    // Abre modal de excluir
    fireEvent.click(screen.getByText('Excluir').closest('button')!);
    const dialog = screen.getByRole('dialog');
    // Confirma excluindo (botão "Excluir" dentro do dialog)
    fireEvent.click(within(dialog).getByText('Excluir'));
    await Promise.resolve();
    // leadIds: lead-1 (Alice), lead-2 (Bruno)
    // clienteIds: cli-1 (Alice), cli-3 (Carla)
    // conversaIds: conv-4 (Diego)
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/contatos/acao-massa', {
      acao: 'excluir',
      leadIds: expect.arrayContaining(['lead-1', 'lead-2']),
      clienteIds: expect.arrayContaining(['cli-1', 'cli-3']),
      conversaIds: expect.arrayContaining(['conv-4']),
    });
    // Confere tamanhos exatos
    const call = vi.mocked(api.post).mock.calls[0][1] as {
      leadIds: string[];
      clienteIds: string[];
      conversaIds: string[];
    };
    expect(call.leadIds).toHaveLength(2);
    expect(call.clienteIds).toHaveLength(2);
    expect(call.conversaIds).toHaveLength(1);
  });
});

// ─── 11 & 12. Importar ──────────────────────────────────────────────────────

describe('fluxo de Importar', () => {
  it('clicar em Importar abre o dialog de escolha', () => {
    render(<ContatosPage />);
    fireEvent.click(screen.getByTestId('contatos-importar-btn'));
    expect(screen.getByText('Importar contatos')).toBeTruthy();
  });

  it('escolher "Importar leads" abre o ImportLeadsModal', () => {
    render(<ContatosPage />);
    fireEvent.click(screen.getByTestId('contatos-importar-btn'));
    fireEvent.click(screen.getByText('Importar leads (entram no funil)'));
    expect(screen.getByTestId('import-leads-modal')).toBeTruthy();
  });

  it('escolher "Importar clientes" abre o ImportClientesModal', () => {
    render(<ContatosPage />);
    fireEvent.click(screen.getByTestId('contatos-importar-btn'));
    fireEvent.click(screen.getByText('Importar clientes'));
    expect(screen.getByTestId('import-clientes-modal')).toBeTruthy();
  });
});
