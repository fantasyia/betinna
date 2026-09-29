/**
 * Itens 6 e 10 do card 📣 (29/09): a empresa escolhe onde o lead de anúncio
 * entra no funil. Grava Empresa.config.entradaAnuncios.
 */
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const patch = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { patch: (...a: unknown[]) => patch(...a) },
  apiErrorMessage: (e: Error) => e.message,
}));
// Referências ESTÁVEIS, como o useApiQuery real (objeto novo a cada render
// faria o useEffect([cfg]) girar sem parar).
const FUNIS = [
  { id: 'f-triagem', nome: 'Triagem (WhatsApp)', etapas: [{ id: 'e-novo', nome: 'Novo (inbound)' }] },
];
const CFG = { entradaAnuncios: { leadAdsEtapaId: 'e-novo' } };
const refetch = vi.fn();
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string) => ({
    data: path === '/funis' ? FUNIS : CFG,
    loading: false,
    error: null,
    refetch,
  }),
}));

import { EntradaAnunciosCard } from './EntradaAnunciosCard';

afterEach(() => {
  cleanup();
  patch.mockReset();
});

describe('EntradaAnunciosCard', () => {
  it('carrega o que está salvo e grava a etapa do CTWA escolhida', async () => {
    patch.mockResolvedValue({});
    const { getByTestId } = render(<EntradaAnunciosCard />);
    expect((getByTestId('entrada-leadads') as HTMLSelectElement).value).toBe('e-novo');
    fireEvent.change(getByTestId('entrada-ctwa'), { target: { value: 'e-novo' } });
    fireEvent.click(getByTestId('entrada-salvar'));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/empresas/config', {
        entradaAnuncios: {
          ctwaEtapaId: 'e-novo',
          leadAdsEtapaId: 'e-novo',
          leadAdsPorFormulario: null,
        },
      }),
    );
  });
});
