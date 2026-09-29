/**
 * Aba Marketplaces (Léo, 29/09): pré-venda e pós-venda separados, e o clique
 * abre a conversa na Inbox (onde já se responde pro canal).
 */
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const navigate = vi.fn();
const pedidos: string[] = [];

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string) => {
    pedidos.push(path);
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

afterEach(() => {
  cleanup();
  navigate.mockReset();
  pedidos.length = 0;
});

describe('ConversasMarketplace', () => {
  it('pede SÓ o grupo da aba (pré-venda) e mostra a pergunta com o canal', () => {
    const { container } = render(<ConversasMarketplace grupo="pre_venda" />);
    expect(pedidos[0]).toBe('/inbox?grupo=pre_venda&limit=50');
    expect(container.textContent).toContain('Mercado Livre');
    expect(container.textContent).toContain('Quero comprar preta como faço ?');
  });

  it('pós-venda pede o grupo pós-venda', () => {
    render(<ConversasMarketplace grupo="pos_venda" />);
    expect(pedidos[0]).toBe('/inbox?grupo=pos_venda&limit=50');
  });

  it('clicar abre a conversa na Inbox pra responder', () => {
    const { getAllByTestId } = render(<ConversasMarketplace grupo="pre_venda" />);
    fireEvent.click(getAllByTestId('mkt-conversa')[0]!);
    expect(navigate).toHaveBeenCalledWith('/inbox?conversa=conv-1');
  });
});
