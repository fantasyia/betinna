import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTemplatesResposta } from './useTemplatesResposta';
import type { Conversation, RespostaRapida } from '../lib/types';

// Mock do client de API pra observar o GET /clientes/:id ({representante}),
// sem rede real.
const get = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: (...args: unknown[]) => get(...args) },
  };
});

// Mock do useApiQuery: roteia por path pra devolver templates + empresaInfo
// controlados (sem TanStack/QueryClient no teste).
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    if (path === '/empresas/atual') {
      return { data: { nome: 'MSM Distribuidora' }, loading: false, error: null, refetch: vi.fn() };
    }
    // '/respostas-rapidas' (ou qualquer outro) — vazio; o teste injeta os
    // templates direto via inserirTemplate(t).
    return { data: [], loading: false, error: null, refetch: vi.fn() };
  },
}));

// composeRef + setResposta compartilhados.
const setResposta = vi.fn();
function makeRef(): React.MutableRefObject<HTMLTextAreaElement | null> {
  return { current: { focus: vi.fn() } as unknown as HTMLTextAreaElement };
}

const convComCliente = {
  id: 'c1',
  cliente: { id: 'cli1', nome: 'João' },
} as Conversation;

const tpl = (conteudo: string): RespostaRapida => ({
  id: 't1',
  titulo: 'Saudação',
  atalho: '/oi',
  conteudo,
  global: false,
});

beforeEach(() => {
  get.mockReset();
  setResposta.mockReset();
  vi.useFakeTimers();
});

describe('useTemplatesResposta', () => {
  it('substitui {nome_cliente}/{nome_empresa} a partir de convData/empresaInfo', async () => {
    const { result } = renderHook(() =>
      useTemplatesResposta(convComCliente, makeRef(), setResposta),
    );
    await act(async () => {
      await result.current.inserirTemplate(tpl('Olá {nome_cliente}, aqui é da {nome_empresa}!'));
    });
    expect(setResposta).toHaveBeenCalledWith('Olá João, aqui é da MSM Distribuidora!');
    // {representante} não estava no template → nenhum GET de cliente.
    expect(get).not.toHaveBeenCalled();
  });

  it('{nome_cliente} cai pra "cliente" quando não há cliente na conversa', async () => {
    const semCliente = { id: 'c2' } as Conversation;
    const { result } = renderHook(() =>
      useTemplatesResposta(semCliente, makeRef(), setResposta),
    );
    await act(async () => {
      await result.current.inserirTemplate(tpl('Oi {nome_cliente}'));
    });
    expect(setResposta).toHaveBeenCalledWith('Oi cliente');
  });

  it('{representante} chama api.get e usa o nome retornado', async () => {
    get.mockResolvedValue({ representante: { nome: 'Carlos Rep' } });
    const { result } = renderHook(() =>
      useTemplatesResposta(convComCliente, makeRef(), setResposta),
    );
    await act(async () => {
      await result.current.inserirTemplate(tpl('Falar com {representante}'));
    });
    expect(get).toHaveBeenCalledWith('/clientes/cli1');
    expect(setResposta).toHaveBeenCalledWith('Falar com Carlos Rep');
  });

  it('sem cliente, {representante} é best-effort (não quebra, vira vazio)', async () => {
    const semCliente = { id: 'c2' } as Conversation;
    const { result } = renderHook(() =>
      useTemplatesResposta(semCliente, makeRef(), setResposta),
    );
    await act(async () => {
      await result.current.inserirTemplate(tpl('Falar com {representante}.'));
    });
    expect(get).not.toHaveBeenCalled();
    expect(setResposta).toHaveBeenCalledWith('Falar com .');
  });

  it('GET de cliente que falha não quebra — {representante} vira vazio', async () => {
    get.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() =>
      useTemplatesResposta(convComCliente, makeRef(), setResposta),
    );
    await act(async () => {
      await result.current.inserirTemplate(tpl('Rep: {representante}|'));
    });
    expect(get).toHaveBeenCalledWith('/clientes/cli1');
    expect(setResposta).toHaveBeenCalledWith('Rep: |');
  });

  it('{ultimo_pedido} é sempre limpo (sem fonte confiável)', async () => {
    const { result } = renderHook(() =>
      useTemplatesResposta(convComCliente, makeRef(), setResposta),
    );
    await act(async () => {
      await result.current.inserirTemplate(tpl('Pedido {ultimo_pedido} ok'));
    });
    expect(setResposta).toHaveBeenCalledWith('Pedido  ok');
  });
});
