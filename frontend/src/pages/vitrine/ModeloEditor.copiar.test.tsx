import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * "Copiar preços de" na aba Grades e preços, pela TELA (Léo, 14/10: "isso não
 * funciona"). Até aqui só a função pura tinha teste.
 */

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: undefined, loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('./ListasEmpresa', () => ({ CorDialog: () => null }));
vi.mock('./FichaTecnica', () => ({ FichaTecnicaAba: () => null }));
vi.mock('./MidiaModelo', () => ({ FotosDaCor: () => null, VideosDoModelo: () => null }));

import { ModeloEditor } from './ModeloEditor';

const tam = (id: string, nome: string, ordem: number) => ({ id, nome, ordem, ativo: true });
const linhas = [
  { id: 'lin-reg', nome: 'Regular', ordem: 0, ativo: true, tamanhos: [tam('t-m', 'M', 0)] },
  { id: 'lin-plus', nome: 'Plus Size', ordem: 1, ativo: true, tamanhos: [tam('t-g1', 'G1', 0)] },
];

afterEach(cleanup);

describe('ModeloEditor — "Copiar preços de"', () => {
  it('escolher a linha copia os preços dela pra esta', () => {
    render(
      <ModeloEditor
        modelo={null}
        cores={[]}
        linhas={linhas as never}
        categorias={[]}
        onClose={vi.fn()}
        onSalvou={vi.fn()}
      />,
    );
    // O texto da aba também aparece no passo a passo do topo: clica no BOTÃO.
    fireEvent.click(screen.getAllByRole('button', { name: /3\. Grades e preços/ })[0]);
    fireEvent.click(screen.getByLabelText('Linha Regular'));
    fireEvent.click(screen.getByLabelText('Linha Plus Size'));

    const entradas = () => screen.getAllByPlaceholderText('sob consulta') as HTMLInputElement[];
    // 1ª linha (Regular): digita o preço de Entrada.
    fireEvent.change(entradas()[0], { target: { value: '18,99' } });

    // Na Plus Size, "Copiar preços de" → Regular.
    fireEvent.change(screen.getByTestId('modelo-copiar-precos-lin-plus'), {
      target: { value: 'lin-reg' },
    });
    // 3 campos "sob consulta" por linha (Entrada, Volume, Atacadão): o 4º é a Entrada da Plus.
    expect(entradas()[3].value).toBe('18,99');
  });
});
