/**
 * Aba Marketplaces (Léo, 29/09): pré-venda e pós-venda separados. Pré-venda
 * responde NA pergunta (sem abrir a Inbox); pós-venda abre a conversa na Inbox.
 */
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const navigate = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const pedidos: string[] = [];
let mensagens: unknown[] = [];

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a) },
  apiErrorMessage: (e: Error) => e.message,
}));

let papel = 'SAC';
vi.mock('@/hooks/usePermission', () => ({ useRole: () => papel }));

// referências ESTÁVEIS, como o useApiQuery real
const CONFIG = {
  respostasProntas: {
    marketplace: [{ titulo: 'Prazo de envio', texto: 'Enviamos em até 24 h úteis.' }],
  },
};
const ANUNCIO = {
  id: 'MLB4685939713',
  titulo: 'Camiseta Básica',
  link: 'https://produto.mercadolivre.com.br/MLB-4685939713',
  status: 'paused',
};

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    if (path) pedidos.push(path);
    if (path?.includes('/mensagens')) {
      return { data: mensagens, loading: false, error: null, refetch: vi.fn() };
    }
    if (path === '/empresas/config') {
      return { data: CONFIG, loading: false, error: null, refetch: vi.fn() };
    }
    if (path?.startsWith('/integracoes/mercadolivre/anuncios/')) {
      return { data: ANUNCIO, loading: false, error: null, refetch: vi.fn() };
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

import { ConversasMarketplace, espera } from './ConversasMarketplace';

const pergunta = {
  id: 'm1',
  direction: 'INBOUND',
  tipo: 'TEXT',
  conteudo: 'Preciso dela toda preta',
  status: 'DELIVERED',
  criadoEm: '2026-09-29T14:45:00.000Z',
  meta: { ml_item_id: 'MLB4685939713' },
};

afterEach(() => {
  cleanup();
  navigate.mockReset();
  post.mockReset();
  patch.mockReset();
  pedidos.length = 0;
  mensagens = [];
  papel = 'SAC';
});

describe('espera (tempo sem resposta)', () => {
  const agora = new Date('2026-09-30T12:00:00.000Z').getTime();
  it('até 1 h ok, até 12 h atenção, depois atrasada', () => {
    expect(espera('2026-09-30T11:30:00.000Z', agora)).toEqual({ texto: 'Aguardando há 30 min', nivel: 'ok' });
    expect(espera('2026-09-30T07:00:00.000Z', agora)).toEqual({ texto: 'Aguardando há 5 h', nivel: 'atencao' });
    expect(espera('2026-09-27T12:00:00.000Z', agora)?.nivel).toBe('atrasada');
    expect(espera('2026-09-27T12:00:00.000Z', agora)?.texto).toBe('Aguardando há 3 dias');
    expect(espera(null, agora)).toBeNull();
  });
});

describe('pré-venda: anúncio, espera e respostas prontas', () => {
  it('mostra o título do anúncio com link, o status pausado e o tempo de espera', () => {
    mensagens = [pergunta];
    const { getByTestId } = render(<ConversasMarketplace grupo="pre_venda" />);
    const a = getByTestId('mkt-anuncio');
    expect(a.textContent).toContain('Camiseta Básica');
    expect(a.textContent).toContain('pausado');
    expect(a.querySelector('a')?.getAttribute('href')).toBe(ANUNCIO.link);
    expect(pedidos).toContain('/integracoes/mercadolivre/anuncios/MLB4685939713');
    expect(getByTestId('mkt-espera').textContent).toContain('Aguardando');
  });

  it('escolher resposta pronta põe o texto no campo e NÃO envia', () => {
    mensagens = [pergunta];
    const { getByTestId } = render(<ConversasMarketplace grupo="pre_venda" />);
    fireEvent.change(getByTestId('mkt-pergunta-pronta'), { target: { value: '0' } });
    expect((getByTestId('mkt-pergunta-texto') as HTMLTextAreaElement).value).toBe(
      'Enviamos em até 24 h úteis.',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('gerenciar respostas prontas: só DIRETOR/ADMIN veem o botão', () => {
    mensagens = [pergunta];
    const sac = render(<ConversasMarketplace grupo="pre_venda" />);
    expect(sac.queryByTestId('prontas-gerenciar')).toBeNull();
    cleanup();
    papel = 'DIRECTOR';
    const dir = render(<ConversasMarketplace grupo="pre_venda" />);
    expect(dir.getByTestId('prontas-gerenciar').textContent).toContain('(1)');
  });

  it('resposta automática: chave própria do ML, gravada em mercadoLivre (não no bot)', async () => {
    papel = 'DIRECTOR';
    patch.mockResolvedValue({});
    const { getByTestId } = render(<ConversasMarketplace grupo="pre_venda" />);
    const t = getByTestId('ml-auto-toggle') as HTMLInputElement;
    expect(t.checked).toBe(false); // desligada por padrão
    fireEvent.click(t);
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/empresas/config', {
        mercadoLivre: { respostaAutomatica: true },
      }),
    );
  });

  it('resposta mandada pela IA aparece como "Respondida pela IA"', () => {
    mensagens = [
      {
        id: 'm9',
        direction: 'OUTBOUND',
        conteudo: 'Temos sim.',
        status: 'SENT',
        enviadaPorBot: true,
        criadoEm: '2026-09-30T10:00:00.000Z',
      },
      pergunta,
    ];
    const { getByTestId } = render(<ConversasMarketplace grupo="pre_venda" />);
    expect(getByTestId('mkt-resposta').textContent).toContain('Respondida pela IA');
  });

  it('SAC não vê o interruptor da resposta automática', () => {
    const { queryByTestId } = render(<ConversasMarketplace grupo="pre_venda" />);
    expect(queryByTestId('ml-auto-toggle')).toBeNull();
  });

  it('salvar grava a lista inteira na config; item sem texto é recusado', async () => {
    papel = 'ADMIN';
    patch.mockResolvedValue({});
    const { getByTestId } = render(<ConversasMarketplace grupo="pre_venda" />);
    fireEvent.click(getByTestId('prontas-gerenciar'));
    fireEvent.click(getByTestId('prontas-adicionar'));
    fireEvent.change(getByTestId('prontas-titulo-1'), { target: { value: 'Garantia' } });
    fireEvent.click(getByTestId('prontas-salvar'));
    expect(getByTestId('prontas-erro').textContent).toContain('título e texto');
    expect(patch).not.toHaveBeenCalled();
    fireEvent.change(getByTestId('prontas-texto-1'), { target: { value: '90 dias de garantia.' } });
    fireEvent.click(getByTestId('prontas-salvar'));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/empresas/config', {
        respostasProntas: {
          marketplace: [
            { titulo: 'Prazo de envio', texto: 'Enviamos em até 24 h úteis.' },
            { titulo: 'Garantia', texto: '90 dias de garantia.' },
          ],
        },
      }),
    );
  });
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
