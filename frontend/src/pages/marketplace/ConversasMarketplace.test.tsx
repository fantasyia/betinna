/**
 * Aba Marketplaces (Léo, 29/09): pré-venda e pós-venda separados. Pré-venda
 * responde NA pergunta (sem abrir a Inbox); pós-venda abre a conversa na Inbox.
 */
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const navigate = vi.fn();
const post = vi.fn();
const pedidos: string[] = [];
let mensagens: unknown[] = [];

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => post(...a) },
  apiErrorMessage: (e: Error) => e.message,
}));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    if (path) pedidos.push(path);
    if (path?.includes('/mensagens')) {
      return { data: mensagens, loading: false, error: null, refetch: vi.fn() };
    }
    return {
      data: {
        data: [
          {
            id: 'conv-1',
            canal: 'MARKETPLACE_ML',
            peerNome: 'Comprador ML #170849466',
            ultimaMsgPreview: 'Quero comprar preta como faço ?',
            ultimaMsgEm: '2026-09-22T15:00:00.000Z',
            naoLidas: 1,
          },
        ],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

import { ConversasMarketplace } from './ConversasMarketplace';

const pergunta = {
  id: 'm1',
  direction: 'INBOUND',
  tipo: 'TEXT',
  conteudo: 'Preciso dela toda preta',
  status: 'DELIVERED',
  criadoEm: '2026-09-29T14:45:00.000Z',
};

afterEach(() => {
  cleanup();
  navigate.mockReset();
  post.mockReset();
  pedidos.length = 0;
  mensagens = [];
});

describe('ConversasMarketplace', () => {
  it('pede SÓ o grupo da aba (pré-venda) e mostra a pergunta com o canal', () => {
    mensagens = [pergunta];
    const { container } = render(<ConversasMarketplace grupo="pre_venda" />);
    expect(pedidos[0]).toBe('/inbox?grupo=pre_venda&limit=50');
    expect(container.textContent).toContain('Mercado Livre');
    expect(container.textContent).toContain('Preciso dela toda preta');
  });

  it('pós-venda pede o grupo pós-venda e o clique abre a Inbox', () => {
    const { getAllByTestId } = render(<ConversasMarketplace grupo="pos_venda" />);
    expect(pedidos[0]).toBe('/inbox?grupo=pos_venda&limit=50');
    fireEvent.click(getAllByTestId('mkt-conversa')[0]!);
    expect(navigate).toHaveBeenCalledWith('/inbox?conversa=conv-1');
  });

  it('pré-venda responde ali mesmo, sem navegar pra Inbox', async () => {
    mensagens = [pergunta];
    post.mockResolvedValue({});
    const { getByTestId } = render(<ConversasMarketplace grupo="pre_venda" />);
    fireEvent.change(getByTestId('mkt-pergunta-texto'), {
      target: { value: 'Tudo preto não temos' },
    });
    fireEvent.click(getByTestId('mkt-pergunta-enviar'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/inbox/conv-1/responder', {
        texto: 'Tudo preto não temos',
      }),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('Sugerir com IA: o texto cai no campo e NADA é enviado sem clicar em Responder', async () => {
    mensagens = [pergunta];
    post.mockResolvedValueOnce({ texto: 'Toda preta não temos, só branca.', precisaHumano: false });
    const { getByTestId } = render(<ConversasMarketplace grupo="pre_venda" />);
    fireEvent.click(getByTestId('mkt-pergunta-ia'));
    await waitFor(() =>
      expect((getByTestId('mkt-pergunta-texto') as HTMLTextAreaElement).value).toBe(
        'Toda preta não temos, só branca.',
      ),
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '/integracoes/mercadolivre/perguntas/conv-1/sugerir-resposta',
    );
  });

  it('IA sem a informação: não preenche nada, avisa e mostra a etiqueta Humano', async () => {
    mensagens = [pergunta];
    post.mockResolvedValueOnce({ texto: null, precisaHumano: true });
    const { getByTestId } = render(<ConversasMarketplace grupo="pre_venda" />);
    fireEvent.click(getByTestId('mkt-pergunta-ia'));
    await waitFor(() => expect(getByTestId('mkt-pergunta-aviso').textContent).toContain('humano'));
    expect((getByTestId('mkt-pergunta-texto') as HTMLTextAreaElement).value).toBe('');
  });

  it('já respondida: mostra a resposta num campo pequeno e esconde o campo de envio', () => {
    // a API devolve da mais nova pra mais antiga
    mensagens = [
      {
        id: 'm3',
        direction: 'OUTBOUND',
        conteudo: 'tudo preto nao temos',
        status: 'SENT',
        criadoEm: '2026-09-29T16:43:00.000Z',
      },
      {
        id: 'm2',
        direction: 'OUTBOUND',
        conteudo: 'tudo preto nao temos',
        status: 'FAILED',
        criadoEm: '2026-09-29T05:58:00.000Z',
      },
      pergunta,
    ];
    const { getAllByTestId, queryByTestId } = render(
      <ConversasMarketplace grupo="pre_venda" />,
    );
    const r = getAllByTestId('mkt-resposta');
    expect(r).toHaveLength(1); // a que falhou não aparece depois que uma foi
    expect(r[0]!.textContent).toContain('Sua resposta');
    expect(queryByTestId('mkt-pergunta-texto')).toBeNull();
  });
});
