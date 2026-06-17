import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Conversation, Mensagem } from '../lib/types';

// ─── Mocks de infraestrutura (hooks + deps externas) ──────────────────────────

// useApiQuery: retorna dados padrão vazios; os testes sobrescrevem via mockReturnValue.
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(() => ({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  })),
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
    post: vi.fn(() => Promise.resolve({})),
    put: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  ApiError: class ApiError extends Error {},
}));

// react-router-dom: useNavigate retorna spy
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// useRole: sem autenticação real nos testes
vi.mock('@/hooks/usePermission', () => ({
  useRole: () => null,
}));

// Hooks de presença/scroll/marcarLida — sem efeito colateral
vi.mock('@/pages/inbox/hooks/usePresencaConversa', () => ({
  usePresencaConversa: () => [],
}));

vi.mock('@/pages/inbox/hooks/useScrollToBottom', () => ({
  useScrollToBottom: () => ({ current: null }),
}));

vi.mock('@/pages/inbox/hooks/useMarcarLida', () => ({
  useMarcarLida: () => undefined,
}));

vi.mock('@/pages/inbox/hooks/useEnvioMensagem', () => ({
  useEnvioMensagem: () => ({
    sending: false,
    sendError: null,
    setSendError: vi.fn(),
    enviarTexto: vi.fn(),
    enviarMidia: vi.fn(),
  }),
}));

vi.mock('@/pages/inbox/hooks/useGravacaoVoz', () => ({
  useGravacaoVoz: () => ({
    gravando: false,
    iniciar: vi.fn(),
    parar: vi.fn(),
  }),
}));

vi.mock('@/pages/inbox/hooks/useAcoesConversa', () => ({
  useAcoesConversa: () => ({
    mudarStatus: vi.fn(),
    alternarBot: vi.fn(),
    definirBotLigado: vi.fn(),
    zerarConversa: vi.fn(),
    reagir: vi.fn(),
  }),
}));

vi.mock('@/pages/inbox/hooks/useTemplatesResposta', () => ({
  useTemplatesResposta: () => ({
    templates: [],
    inserirTemplate: vi.fn(),
  }),
}));

// ─── Mocks de filhos pesados (não são o alvo desta suite) ────────────────────

vi.mock('@/pages/inbox/components/ThreadHeader', () => ({
  ThreadHeader: ({ conv }: { conv: Conversation | null | undefined }) => (
    <div data-testid="thread-header">
      {conv ? <span data-testid="header-conv-id">{conv.id}</span> : null}
    </div>
  ),
}));

vi.mock('@/pages/inbox/components/ThreadMensagens', () => ({
  ThreadMensagens: ({ messages }: { messages: Mensagem[] }) => (
    <div data-testid="thread-mensagens" data-count={messages.length} />
  ),
}));

vi.mock('@/pages/inbox/components/Composer', () => ({
  Composer: () => <div data-testid="composer" />,
}));

vi.mock('@/pages/inbox/components/BarraTagsTriagem', () => ({
  BarraTagsTriagem: () => <div data-testid="barra-tags" />,
}));

vi.mock('@/pages/inbox/components/AvisoPresenca', () => ({
  AvisoPresenca: () => <div data-testid="aviso-presenca" />,
}));

vi.mock('@/pages/inbox/components/ClienteContextDrawer', () => ({
  ClienteContextDrawer: () => null,
}));

vi.mock('@/pages/inbox/components/NotasInternasDrawer', () => ({
  NotasInternasDrawer: () => null,
}));

vi.mock('@/pages/inbox/components/AtribuirModal', () => ({
  AtribuirModal: () => null,
}));

vi.mock('@/components/NovoPedidoDialog', () => ({
  NovoPedidoDialog: () => null,
}));

// ─── Import APÓS os mocks ─────────────────────────────────────────────────────

import { ConversationThread } from './ConversationThread';
import { useApiQuery } from '@/hooks/useApiQuery';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fakeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    canal: 'WHATSAPP',
    status: 'ABERTA',
    peerId: '5511999990000@s.whatsapp.net',
    ...overrides,
  };
}

function fakeMensagem(id: string): Mensagem {
  return {
    id,
    conteudo: `Mensagem ${id}`,
    direction: 'INBOUND',
    tipo: 'TEXT',
    criadoEm: '2026-06-16T10:00:00.000Z',
  };
}

const mockUseApiQuery = vi.mocked(useApiQuery);

afterEach(() => cleanup());

beforeEach(() => {
  // Reset pra retorno padrão vazio
  mockUseApiQuery.mockReturnValue({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
});

// ─── Suites ──────────────────────────────────────────────────────────────────

describe('ConversationThread — renderização estrutural', () => {
  it('renderiza o ThreadHeader sempre (mesmo sem dados carregados ainda)', () => {
    render(<ConversationThread id="conv-1" onChanged={vi.fn()} />);
    expect(screen.getByTestId('thread-header')).toBeTruthy();
  });

  it('renderiza o ThreadMensagens sempre', () => {
    render(<ConversationThread id="conv-1" onChanged={vi.fn()} />);
    expect(screen.getByTestId('thread-mensagens')).toBeTruthy();
  });

  it('renderiza o Composer sempre', () => {
    render(<ConversationThread id="conv-1" onChanged={vi.fn()} />);
    expect(screen.getByTestId('composer')).toBeTruthy();
  });

  it('renderiza BarraTagsTriagem', () => {
    render(<ConversationThread id="conv-1" onChanged={vi.fn()} />);
    expect(screen.getByTestId('barra-tags')).toBeTruthy();
  });

  it('renderiza AvisoPresenca', () => {
    render(<ConversationThread id="conv-1" onChanged={vi.fn()} />);
    expect(screen.getByTestId('aviso-presenca')).toBeTruthy();
  });
});

describe('ConversationThread — com conversa carregada', () => {
  it('passa conv.id para o ThreadHeader quando dados chegam', () => {
    const conv = fakeConv({ id: 'conv-xyz' });

    mockUseApiQuery.mockImplementation((path: string | null) => {
      if (path === '/inbox/conv-xyz') {
        return { data: conv, loading: false, error: null, refetch: vi.fn() };
      }
      // mensagens
      return { data: [] as Mensagem[], loading: false, error: null, refetch: vi.fn() };
    });

    render(<ConversationThread id="conv-xyz" onChanged={vi.fn()} />);
    const convId = screen.getByTestId('header-conv-id');
    expect(convId.textContent).toBe('conv-xyz');
  });

  it('passa a lista de mensagens para ThreadMensagens', () => {
    const conv = fakeConv({ id: 'conv-2' });
    const msgs = [fakeMensagem('m1'), fakeMensagem('m2')];

    mockUseApiQuery.mockImplementation((path: string | null) => {
      if (path === '/inbox/conv-2') {
        return { data: conv, loading: false, error: null, refetch: vi.fn() };
      }
      // Qualquer outro path (mensagens, empresa)
      return { data: msgs, loading: false, error: null, refetch: vi.fn() };
    });

    render(<ConversationThread id="conv-2" onChanged={vi.fn()} />);
    const mensagens = screen.getByTestId('thread-mensagens');
    expect(mensagens.getAttribute('data-count')).toBe('2');
  });

  it('ThreadMensagens recebe lista vazia quando mensagens ainda não carregaram', () => {
    render(<ConversationThread id="conv-1" onChanged={vi.fn()} />);
    const mensagens = screen.getByTestId('thread-mensagens');
    expect(mensagens.getAttribute('data-count')).toBe('0');
  });
});

describe('ConversationThread — prop id diferente', () => {
  it('renderiza sem erros para um id genérico', () => {
    render(<ConversationThread id="qualquer-id-99" onChanged={vi.fn()} />);
    expect(screen.getByTestId('thread-header')).toBeTruthy();
  });
});
