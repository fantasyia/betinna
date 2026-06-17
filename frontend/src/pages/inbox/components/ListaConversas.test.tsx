/**
 * Testes de render para ListaConversas.
 *
 * Observáveis cobertos:
 *  - estado vazio (pageResp.data = []) → "Nenhuma conversa nesse filtro."
 *  - estado loading (loading=true, pageResp=null) → StateView loading
 *  - estado error → StateView error + botão retry chama refetch
 *  - N conversas → N ConversationItems renderizados
 *  - clicar num item chama onSelect com o id correto
 *  - item ativo: ConversationItem recebe active=true só para selectedId
 *  - campo de busca: onChange chama setSearch com o valor digitado
 *  - select status: onChange chama setStatus
 *  - select filterMeu: onChange chama setFilterMeu
 *  - select situacao: onChange chama setSituacao
 *  - botão de som: chama alternarSom; ícone reflete somLigado
 *  - tabs de canal: onChange chama setCanalTab
 *
 * Estratégia: mockar ConversationItem como <li data-conv-id={conv.id} />
 * para isolar a lista e contar itens sem depender dos internos do item.
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { Conversation } from '../lib/types';

// ─── mock ConversationItem ────────────────────────────────────────────────────
vi.mock('./ConversationItem', () => ({
  ConversationItem: ({ conv, active, onClick }: { conv: Conversation; active: boolean; onClick: (id: string) => void }) => (
    <li data-testid={`mock-conv-${conv.id}`} data-active={String(active)}>
      <button type="button" onClick={() => onClick(conv.id)}>
        {conv.id}
      </button>
    </li>
  ),
}));

// Importar DEPOIS do mock
import { ListaConversas } from './ListaConversas';
import type { PaginatedResponse } from '@/hooks/useApiQuery';

afterEach(() => cleanup());

// ─── factory de props ─────────────────────────────────────────────────────────

function makeConv(id: string): Conversation {
  return {
    id,
    canal: 'WHATSAPP',
    status: 'ABERTA',
    peerId: `551199999${id}@s.whatsapp.net`,
    naoLidas: 0,
  };
}

function makePageResp(convs: Conversation[]): PaginatedResponse<Conversation> {
  return {
    data: convs,
    pagination: { page: 1, limit: 50, total: convs.length, totalPages: 1 },
  };
}

function defaultProps(
  overrides: Partial<Parameters<typeof ListaConversas>[0]> = {},
): Parameters<typeof ListaConversas>[0] {
  return {
    canalTab: 'todos',
    setCanalTab: vi.fn(),
    status: '',
    setStatus: vi.fn(),
    filterMeu: '',
    setFilterMeu: vi.fn(),
    situacao: '',
    setSituacao: vi.fn(),
    search: '',
    setSearch: vi.fn(),
    pageResp: makePageResp([]),
    loading: false,
    error: null,
    refetch: vi.fn(),
    selectedId: null,
    onSelect: vi.fn(),
    somLigado: false,
    alternarSom: vi.fn(),
    botGlobalAtivo: false,
    ...overrides,
  };
}

// ─── estado vazio ─────────────────────────────────────────────────────────────

describe('estado vazio', () => {
  it('mostra mensagem de vazio quando pageResp.data está vazia e não está carregando', () => {
    render(<ListaConversas {...defaultProps()} />);
    expect(screen.getByTestId('state-empty')).toBeTruthy();
    expect(screen.getByText('Nenhuma conversa nesse filtro.')).toBeTruthy();
  });

  it('NÃO mostra estado vazio quando há conversas', () => {
    const props = defaultProps({ pageResp: makePageResp([makeConv('1'), makeConv('2')]) });
    render(<ListaConversas {...props} />);
    expect(screen.queryByTestId('state-empty')).toBeNull();
  });
});

// ─── estado loading ───────────────────────────────────────────────────────────

describe('estado loading', () => {
  it('mostra skeleton de loading quando loading=true e pageResp=null', () => {
    render(<ListaConversas {...defaultProps({ loading: true, pageResp: null })} />);
    expect(screen.getByTestId('state-loading')).toBeTruthy();
  });

  it('NÃO mostra loading quando pageResp já chegou (polling silencioso)', () => {
    // loading=true mas pageResp já tem data → exibe lista, não skeleton
    const props = defaultProps({
      loading: true,
      pageResp: makePageResp([makeConv('a')]),
    });
    render(<ListaConversas {...props} />);
    expect(screen.queryByTestId('state-loading')).toBeNull();
    expect(screen.getByTestId('mock-conv-a')).toBeTruthy();
  });
});

// ─── estado de erro ───────────────────────────────────────────────────────────

describe('estado de erro', () => {
  it('mostra mensagem de erro quando error está preenchido', () => {
    render(<ListaConversas {...defaultProps({ error: 'Falha na conexão', pageResp: null })} />);
    expect(screen.getByTestId('state-error')).toBeTruthy();
    expect(screen.getByText('Falha na conexão')).toBeTruthy();
  });

  it('botão "Tentar novamente" chama refetch', () => {
    const refetch = vi.fn();
    render(
      <ListaConversas {...defaultProps({ error: 'Timeout', pageResp: null, refetch })} />,
    );
    fireEvent.click(screen.getByTestId('state-retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ─── renderização da lista ────────────────────────────────────────────────────

describe('renderização da lista', () => {
  it('renderiza exatamente N ConversationItems para N conversas', () => {
    const convs = [makeConv('1'), makeConv('2'), makeConv('3')];
    render(<ListaConversas {...defaultProps({ pageResp: makePageResp(convs) })} />);
    expect(screen.getAllByTestId(/^mock-conv-/).length).toBe(3);
  });

  it('renderiza lista vazia sem itens quando data=[]', () => {
    render(<ListaConversas {...defaultProps({ pageResp: makePageResp([]) })} />);
    expect(screen.queryAllByTestId(/^mock-conv-/).length).toBe(0);
  });
});

// ─── seleção de item ──────────────────────────────────────────────────────────

describe('seleção de item', () => {
  it('clicar num ConversationItem chama onSelect com o id correto', () => {
    const onSelect = vi.fn();
    const convs = [makeConv('id-A'), makeConv('id-B')];
    render(
      <ListaConversas {...defaultProps({ pageResp: makePageResp(convs), onSelect })} />,
    );
    fireEvent.click(screen.getByTestId('mock-conv-id-B').querySelector('button')!);
    expect(onSelect).toHaveBeenCalledWith('id-B');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('passa active=true apenas para o selectedId', () => {
    const convs = [makeConv('x'), makeConv('y'), makeConv('z')];
    render(
      <ListaConversas
        {...defaultProps({ pageResp: makePageResp(convs), selectedId: 'y' })}
      />,
    );
    expect(screen.getByTestId('mock-conv-x').getAttribute('data-active')).toBe('false');
    expect(screen.getByTestId('mock-conv-y').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('mock-conv-z').getAttribute('data-active')).toBe('false');
  });

  it('nenhum item ativo quando selectedId=null', () => {
    const convs = [makeConv('a'), makeConv('b')];
    render(
      <ListaConversas
        {...defaultProps({ pageResp: makePageResp(convs), selectedId: null })}
      />,
    );
    const items = screen.getAllByTestId(/^mock-conv-/);
    items.forEach((el) => expect(el.getAttribute('data-active')).toBe('false'));
  });
});

// ─── campo de busca ───────────────────────────────────────────────────────────

describe('campo de busca', () => {
  it('chama setSearch com o valor digitado', () => {
    const setSearch = vi.fn();
    render(<ListaConversas {...defaultProps({ setSearch })} />);
    const input = screen.getByPlaceholderText('Buscar…');
    fireEvent.change(input, { target: { value: 'Maria' } });
    expect(setSearch).toHaveBeenCalledWith('Maria');
  });

  it('exibe o valor atual de search no input', () => {
    render(<ListaConversas {...defaultProps({ search: 'João' })} />);
    const input = screen.getByPlaceholderText('Buscar…') as HTMLInputElement;
    expect(input.value).toBe('João');
  });
});

// ─── selects de filtro ────────────────────────────────────────────────────────

describe('select de status', () => {
  it('chama setStatus quando usuário muda o select', () => {
    const setStatus = vi.fn();
    render(<ListaConversas {...defaultProps({ setStatus })} />);
    const select = screen.getByTestId('inbox-status') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'RESOLVIDA' } });
    expect(setStatus).toHaveBeenCalledWith('RESOLVIDA');
  });

  it('exibe o valor atual de status', () => {
    render(<ListaConversas {...defaultProps({ status: 'PENDENTE' })} />);
    const select = screen.getByTestId('inbox-status') as HTMLSelectElement;
    expect(select.value).toBe('PENDENTE');
  });
});

describe('select filterMeu', () => {
  it('chama setFilterMeu quando usuário muda o select', () => {
    const setFilterMeu = vi.fn();
    render(<ListaConversas {...defaultProps({ setFilterMeu })} />);
    const select = screen.getByTestId('inbox-meu') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'meu' } });
    expect(setFilterMeu).toHaveBeenCalledWith('meu');
  });
});

describe('select situacao', () => {
  it('chama setSituacao quando usuário muda o select', () => {
    const setSituacao = vi.fn();
    render(<ListaConversas {...defaultProps({ setSituacao })} />);
    const select = screen.getByTestId('inbox-situacao') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'nao_lidas' } });
    expect(setSituacao).toHaveBeenCalledWith('nao_lidas');
  });
});

// ─── botão de som ─────────────────────────────────────────────────────────────

describe('botão de som', () => {
  it('chama alternarSom ao clicar no botão de som', () => {
    const alternarSom = vi.fn();
    render(<ListaConversas {...defaultProps({ alternarSom })} />);
    fireEvent.click(screen.getByTestId('inbox-som-toggle'));
    expect(alternarSom).toHaveBeenCalledTimes(1);
  });

  it('botão tem title "ligado" quando somLigado=true', () => {
    render(<ListaConversas {...defaultProps({ somLigado: true })} />);
    const btn = screen.getByTestId('inbox-som-toggle');
    expect(btn.getAttribute('title')).toContain('ligado');
  });

  it('botão tem title "desligado" quando somLigado=false', () => {
    render(<ListaConversas {...defaultProps({ somLigado: false })} />);
    const btn = screen.getByTestId('inbox-som-toggle');
    expect(btn.getAttribute('title')).toContain('desligado');
  });
});

// ─── tabs de canal ────────────────────────────────────────────────────────────

describe('tabs de canal', () => {
  it('chama setCanalTab ao clicar em tab de canal diferente', () => {
    const setCanalTab = vi.fn();
    render(<ListaConversas {...defaultProps({ setCanalTab, canalTab: 'todos' })} />);
    // Tabs renderiza botões com o label das tabs
    const waTab = screen.getByText('WA');
    fireEvent.click(waTab);
    expect(setCanalTab).toHaveBeenCalledWith('wa');
  });

  it('renderiza as 5 tabs esperadas (Todos/WA/IG/FB/EM)', () => {
    render(<ListaConversas {...defaultProps()} />);
    expect(screen.getByText('Todos')).toBeTruthy();
    expect(screen.getByText('WA')).toBeTruthy();
    expect(screen.getByText('IG')).toBeTruthy();
    expect(screen.getByText('FB')).toBeTruthy();
    expect(screen.getByText('EM')).toBeTruthy();
  });
});
