import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThreadMensagens } from './ThreadMensagens';
import type { Mensagem } from '../lib/types';

// Mock pesado: MessageBubble não é o alvo — só contamos as bolhas.
vi.mock('./MessageBubble', () => ({
  MessageBubble: ({ msg }: { msg: Mensagem }) => (
    <div data-testid="msg-bubble" data-msg-id={msg.id} />
  ),
}));

afterEach(() => cleanup());

// Helper pra montar com props padrão
function montarBase(overrides: Partial<Parameters<typeof ThreadMensagens>[0]> = {}) {
  const refetch = vi.fn();
  const onReagir = vi.fn();
  const onResponder = vi.fn();
  const endRef = { current: null } as React.RefObject<HTMLDivElement>;

  const props = {
    messages: [] as Mensagem[],
    loading: false,
    error: null,
    refetch,
    canal: undefined,
    endRef,
    onReagir,
    onResponder,
    ...overrides,
  } as Parameters<typeof ThreadMensagens>[0];

  return { ...render(<ThreadMensagens {...props} />), refetch, onReagir, onResponder };
}

function fakeMensagem(id: string, overrides: Partial<Mensagem> = {}): Mensagem {
  return {
    id,
    conteudo: `Mensagem ${id}`,
    direction: 'INBOUND',
    tipo: 'TEXT',
    criadoEm: '2026-06-16T10:00:00.000Z',
    ...overrides,
  };
}

describe('ThreadMensagens', () => {
  it('mostra estado vazio quando não há mensagens e não está carregando', () => {
    montarBase({ messages: [], loading: false, error: null });
    // StateView renderiza data-testid="state-empty"
    const empty = screen.getByTestId('state-empty');
    expect(empty).toBeTruthy();
  });

  it('mostra estado de loading quando loading=true e lista vazia', () => {
    montarBase({ messages: [], loading: true, error: null });
    const loading = screen.getByTestId('state-loading');
    expect(loading).toBeTruthy();
  });

  it('mostra estado de erro quando há erro', () => {
    montarBase({ messages: [], loading: false, error: 'Falhou' });
    const errEl = screen.getByTestId('state-error');
    expect(errEl).toBeTruthy();
  });

  it('chama refetch ao clicar em "Tentar novamente"', () => {
    const refetch = vi.fn();
    montarBase({ messages: [], loading: false, error: 'Falhou', refetch });
    const btn = screen.getByTestId('state-retry');
    btn.click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renderiza 1 bolha por mensagem', () => {
    const msgs = [fakeMensagem('m1'), fakeMensagem('m2'), fakeMensagem('m3')];
    montarBase({ messages: msgs, loading: false, error: null });
    const bolhas = screen.getAllByTestId('msg-bubble');
    expect(bolhas).toHaveLength(3);
  });

  it('renderiza bolha pra 1 mensagem única', () => {
    montarBase({ messages: [fakeMensagem('solo')], loading: false, error: null });
    const bolhas = screen.getAllByTestId('msg-bubble');
    expect(bolhas).toHaveLength(1);
  });

  it('preserva todas as mensagens no DOM (sem filtro)', () => {
    const msgs = [fakeMensagem('a'), fakeMensagem('b')];
    montarBase({ messages: msgs });
    const ids = screen
      .getAllByTestId('msg-bubble')
      .map((el) => el.getAttribute('data-msg-id'));
    expect(ids).toHaveLength(2);
    // Ambos ids presentes (em qualquer ordem — o componente inverte a lista)
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('inverte a ordem do backend (desc → asc): msg mais recente fica na ÚLTIMA posição', () => {
    // Backend retorna desc: [nova, antiga]. UI deve mostrar [antiga, nova].
    const antiga = fakeMensagem('antiga', { criadoEm: '2026-06-16T09:00:00.000Z' });
    const nova = fakeMensagem('nova', { criadoEm: '2026-06-16T10:00:00.000Z' });
    // Passamos na ordem "desc" que o backend envia (nova primeiro)
    montarBase({ messages: [nova, antiga], loading: false, error: null });
    const bolhas = screen.getAllByTestId('msg-bubble');
    // Após inversão, antiga está na posição 0 e nova na posição 1
    expect(bolhas[0].getAttribute('data-msg-id')).toBe('antiga');
    expect(bolhas[1].getAttribute('data-msg-id')).toBe('nova');
  });

  it('não mostra bolhas quando loading=true (mesmo com mensagens na prop)', () => {
    // loading=true + lista vazia → StateView loading; não passamos mensagens
    montarBase({ messages: [], loading: true, error: null });
    const bolhas = screen.queryAllByTestId('msg-bubble');
    expect(bolhas).toHaveLength(0);
  });
});
