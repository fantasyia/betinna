import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * Insumos com cores (Léo, 07/10): uma linha por cor com saldo e custo dela,
 * cores da lista da empresa no cadastro, e a compra/perda vão com a cor.
 */

const estado = vi.hoisted(() => ({ insumos: [] as unknown[] }));
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiUpload = vi.fn();

vi.mock('@/hooks/usePermission', () => ({ useRole: () => 'DIRECTOR' }));
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => ({
    data:
      path === '/erp/insumos'
        ? estado.insumos
        : path === '/erp/insumos/cores'
          ? [
              { id: 'cor-preto', nome: 'Preto', hex: '#2D2C2F', ativo: true },
              { id: 'cor-bege', nome: 'Bege', hex: '#D5BA98', ativo: true },
              { id: 'cor-cinza', nome: 'Cinza-Claro', hex: '#BABAB8', ativo: true },
            ]
          : [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/lib/api', () => ({
  api: {
    post: (...a: unknown[]) => apiPost(...a),
    put: (...a: unknown[]) => apiPut(...a),
    upload: (...a: unknown[]) => apiUpload(...a),
    delete: vi.fn(),
  },
  apiErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/CatalogoTabs', () => ({ CatalogoTabs: () => null }));
vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
}));

import InsumosPage from './InsumosPage';

const cor = (id: string, corId: string, nome: string, saldo: number, custo: number) => ({
  id,
  corId,
  nome,
  hex: '#000000',
  ativo: true,
  custoMedio: custo,
  saldo,
  valorEmEstoque: saldo * custo,
  repor: false,
});

const moletinho = {
  id: 'mol',
  nome: 'Moletinho 65% poliéster 35% algodão',
  tipo: 'TECIDO',
  unidade: 'KG',
  cor: null,
  fornecedor: null,
  ativo: true,
  custoMedio: 33,
  estoqueMinimo: null,
  saldo: 30,
  valorEmEstoque: 960,
  repor: false,
  temCores: true,
  cores: [
    cor('ic-preto', 'cor-preto', 'Preto', 20, 30),
    cor('ic-bege', 'cor-bege', 'Bege', 10, 36),
  ],
};

afterEach(() => {
  cleanup();
  apiPost.mockReset();
  apiPut.mockReset();
  apiUpload.mockReset();
});

describe('InsumosPage — insumo com cores', () => {
  it('mostra uma linha por cor, com o saldo DELA', () => {
    estado.insumos = [moletinho];
    render(<InsumosPage />);
    expect(screen.getByTestId('insumo-cor-ic-preto').textContent).toContain('Preto');
    expect(screen.getByTestId('insumo-cor-ic-preto').textContent).toContain('20 kg');
    expect(screen.getByTestId('insumo-cor-ic-bege').textContent).toContain('10 kg');
  });

  it('compra pela linha da cor vai com aquela cor', async () => {
    estado.insumos = [moletinho];
    apiPost.mockResolvedValue({});
    render(<InsumosPage />);
    fireEvent.click(screen.getByTestId('insumo-cor-compra-ic-bege'));
    expect((screen.getByTestId('mov-cor') as HTMLSelectElement).value).toBe('ic-bege');
    fireEvent.change(screen.getByTestId('compra-qtd'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('compra-valor'), { target: { value: '400' } });
    // prévia usa o saldo e o custo DO BEGE: 10 kg a 36 + 10 kg a 40 = 38
    expect(screen.getByTestId('compra-previa').textContent).toMatch(/do Bege/);
    expect(screen.getByTestId('compra-previa').textContent).toMatch(/38,00/);
    fireEvent.click(screen.getByTestId('compra-salvar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][0]).toBe('/erp/insumos/mol/compras');
    expect(apiPost.mock.calls[0][1]).toMatchObject({ insumoCorId: 'ic-bege', quantidade: 10 });
  });

  it('cadastro: marca as cores da lista da empresa e manda `cores`', async () => {
    estado.insumos = [];
    apiPost.mockResolvedValue({});
    render(<InsumosPage />);
    fireEvent.click(screen.getByTestId('insumo-novo'));
    fireEvent.change(screen.getByTestId('insumo-nome'), { target: { value: 'Ribana' } });
    fireEvent.click(screen.getByTestId('insumo-cor-opcao-cor-preto'));
    fireEvent.click(screen.getByTestId('insumo-cor-opcao-cor-cinza'));
    fireEvent.click(screen.getByTestId('insumo-salvar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][1]).toMatchObject({
      nome: 'Ribana',
      cores: ['cor-preto', 'cor-cinza'],
      cor: null,
    });
  });

  it('COPIAR (Léo, 14/10): novo insumo com nome (cópia), tipo, unidade, fornecedor e TODAS as cores', async () => {
    estado.insumos = [{ ...moletinho, fornecedor: 'Malharia X' }];
    apiPost.mockResolvedValue({});
    render(<InsumosPage />);
    fireEvent.click(screen.getByTestId('insumo-copiar-mol'));
    expect((screen.getByTestId('insumo-nome') as HTMLInputElement).value).toBe(
      'Moletinho 65% poliéster 35% algodão (cópia)',
    );
    fireEvent.click(screen.getByTestId('insumo-salvar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    // É um insumo NOVO (POST), nunca uma edição do original (PUT).
    expect(apiPut).not.toHaveBeenCalled();
    const [rota, corpo] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(rota).toBe('/erp/insumos');
    expect(corpo).toMatchObject({
      nome: 'Moletinho 65% poliéster 35% algodão (cópia)',
      tipo: 'TECIDO',
      unidade: 'KG',
      fornecedor: 'Malharia X',
      cores: ['cor-preto', 'cor-bege'],
    });
    // Saldo, custo e movimento não viajam: o novo nasce zerado.
    expect(corpo).not.toHaveProperty('custoMedio');
    expect(corpo).not.toHaveProperty('saldo');
  });

  it('PREÇO DE REFERÊNCIA (Léo, 14/10): por cor, pela cor da lista da empresa', async () => {
    estado.insumos = [moletinho];
    apiPut.mockResolvedValue({ ...moletinho });
    render(<InsumosPage />);
    fireEvent.click(screen.getByText('Moletinho 65% poliéster 35% algodão'));
    fireEvent.change(screen.getByTestId('insumo-preco-cor-bege'), { target: { value: '35,50' } });
    fireEvent.click(screen.getByTestId('insumo-salvar'));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const corpo = apiPut.mock.calls[0][1] as Record<string, unknown>;
    expect(corpo.precosCor).toEqual({ 'cor-preto': null, 'cor-bege': 35.5 });
    expect(corpo.precoReferencia).toBeNull();
  });

  it('insumo SEM cores: um preço de referência do insumo', async () => {
    const ribana = { ...moletinho, id: 'rib', nome: 'Ribana', temCores: false, cores: [] };
    estado.insumos = [ribana];
    apiPut.mockResolvedValue(ribana);
    render(<InsumosPage />);
    fireEvent.click(screen.getByText('Ribana'));
    fireEvent.change(screen.getByTestId('insumo-preco-geral'), { target: { value: '28' } });
    fireEvent.click(screen.getByTestId('insumo-salvar'));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect((apiPut.mock.calls[0][1] as Record<string, unknown>).precoReferencia).toBe(28);
  });

  it('custo que ainda é da referência aparece marcado na lista', () => {
    estado.insumos = [
      {
        ...moletinho,
        cores: [{ ...cor('ic-bege', 'cor-bege', 'Bege', 0, 35.5), custoDaReferencia: true }],
      },
    ];
    render(<InsumosPage />);
    expect(screen.getByTestId('insumo-cor-ic-bege').textContent).toContain('referência');
  });

  it('insumo SEM cores: compra não pede cor (como antes)', async () => {
    estado.insumos = [{ ...moletinho, id: 'etq', nome: 'Etiqueta', temCores: false, cores: [] }];
    apiPost.mockResolvedValue({});
    render(<InsumosPage />);
    fireEvent.click(screen.getByTestId('insumo-compra-etq'));
    expect(screen.queryByTestId('mov-cor')).toBeNull();
    fireEvent.change(screen.getByTestId('compra-qtd'), { target: { value: '5' } });
    fireEvent.change(screen.getByTestId('compra-valor'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('compra-salvar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][1].insumoCorId).toBeNull();
  });
});
