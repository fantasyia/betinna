import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/** Ficha técnica: quantidade POR TAMANHO (elástico, Léo 14/10) e observação que não some. */

const apiPut = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { put: (...a: unknown[]) => apiPut(...a), get: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const ELASTICO = {
  id: 'el',
  nome: 'Elástico de embutir 45 mm',
  tipo: 'AVIAMENTO',
  unidade: 'METRO',
  cor: null,
  ativo: true,
  custoMedio: 1,
  temCores: false,
  cores: [],
};
// Objetos FIXOS: a tela reseta o estado quando `data` muda — um objeto novo a
// cada render vira loop.
const fixos = vi.hoisted(() => {
  const ficha = {
    modeloLinhaId: 'ml-reg',
    linha: 'Regular',
    tamanhos: ['P', 'M', 'G'],
    existe: true,
    custoFaccaoPrevisto: null,
    observacoes: null,
    itens: [
      {
        insumoId: 'el',
        consumoPorPeca: 0.8,
        porTamanho: null,
        observacao: 'PENDENTE: medida (Léo)',
        corFixa: null,
      },
    ],
    semCusto: [],
  };
  const r = (data: unknown) => ({ data, loading: false, error: null, refetch: () => undefined });
  return { insumos: r([] as unknown[]), ficha: r(ficha), regras: r({ regras: null }) };
});
fixos.insumos.data = [ELASTICO];
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) =>
    path?.startsWith('/erp/insumos') ? fixos.insumos : path?.startsWith('/erp/fichas/') ? fixos.ficha : fixos.regras,
}));

import { FichaTecnicaAba } from './FichaTecnica';

afterEach(() => {
  cleanup();
  apiPut.mockReset();
});

describe('Ficha técnica — por tamanho', () => {
  it('liga "por tamanho", preenche cada um e salva o mapa + a média; a observação volta intacta', async () => {
    apiPut.mockResolvedValue({});
    render(<FichaTecnicaAba modeloId="m-1" linhas={[{ id: 'ml-reg', nome: 'Regular' }]} />);
    fireEvent.click(screen.getByTestId('ficha-por-tamanho-0'));
    fireEvent.change(screen.getByTestId('ficha-tam-0-P'), { target: { value: '0,76' } });
    fireEvent.change(screen.getByTestId('ficha-tam-0-M'), { target: { value: '0,80' } });
    fireEvent.change(screen.getByTestId('ficha-tam-0-G'), { target: { value: '0,84' } });
    fireEvent.click(screen.getByTestId('ficha-salvar-ml-reg'));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const item = apiPut.mock.calls[0][1].itens[0];
    expect(item.porTamanho).toEqual({ P: 0.76, M: 0.8, G: 0.84 });
    expect(item.consumoPorPeca).toBeCloseTo(0.8, 6);
    expect(item.observacao).toBe('PENDENTE: medida (Léo)');
  });

  it('sem "por tamanho": manda porTamanho null (um consumo só)', async () => {
    apiPut.mockResolvedValue({});
    render(<FichaTecnicaAba modeloId="m-1" linhas={[{ id: 'ml-reg', nome: 'Regular' }]} />);
    fireEvent.click(screen.getByTestId('ficha-salvar-ml-reg'));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(apiPut.mock.calls[0][1].itens[0]).toMatchObject({ consumoPorPeca: 0.8, porTamanho: null });
  });
});
