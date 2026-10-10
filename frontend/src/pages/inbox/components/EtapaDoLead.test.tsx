import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/** Etapa do funil mudada de dentro da conversa (Léo, 10/10). */

const estado = vi.hoisted(() => ({ perm: { ver: true, editar: true } }));
const put = vi.fn();
const refetch = vi.fn();
vi.mock('@/hooks/usePermission', () => ({ useModulo: () => estado.perm }));
vi.mock('@/lib/api', () => ({
  api: { put: (...a: unknown[]) => put(...a) },
  apiErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    if (!path) return { data: undefined, refetch };
    if (path.startsWith('/leads/'))
      return {
        data: {
          id: 'lead-1',
          funil: { id: 'f-1', nome: 'Vendas' },
          funilEtapa: { id: 'e-novo', nome: 'Novo' },
        },
        refetch,
      };
    return {
      data: {
        id: 'f-1',
        etapas: [
          { id: 'e-reuniao', nome: 'Reunião marcada', ordem: 2 },
          { id: 'e-novo', nome: 'Novo', ordem: 1 },
          { id: 'e-perdido', nome: 'Perdido', ordem: 3, tipo: 'PERDIDO' },
        ],
      },
      refetch,
    };
  },
}));

import { EtapaDoLead } from './EtapaDoLead';

afterEach(() => {
  cleanup();
  put.mockReset();
  refetch.mockReset();
  estado.perm = { ver: true, editar: true };
});

describe('<EtapaDoLead>', () => {
  it('mostra as etapas do funil na ordem, com a atual marcada', () => {
    render(<EtapaDoLead leadId="lead-1" />);
    const sel = screen.getByTestId('inbox-etapa-lead') as HTMLSelectElement;
    expect(sel.value).toBe('e-novo');
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      'Novo',
      'Reunião marcada',
      'Perdido',
    ]);
  });

  it('trocar a etapa move o lead pela rota do funil e atualiza', async () => {
    put.mockResolvedValue({});
    render(<EtapaDoLead leadId="lead-1" />);
    fireEvent.change(screen.getByTestId('inbox-etapa-lead'), { target: { value: 'e-reuniao' } });
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/leads/lead-1/etapa', { funilEtapaId: 'e-reuniao' }),
    );
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('Perdido PEDE o motivo antes de mover, e manda o motivo junto (Léo, 10/10)', async () => {
    put.mockResolvedValue({});
    render(<EtapaDoLead leadId="lead-1" />);
    fireEvent.change(screen.getByTestId('inbox-etapa-lead'), { target: { value: 'e-perdido' } });

    // Não move sem motivo: abre a janela e o Confirmar fica travado vazio.
    expect(put).not.toHaveBeenCalled();
    const confirmar = screen.getByTestId('inbox-etapa-motivo-confirmar') as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('inbox-etapa-motivo'), {
      target: { value: '  Escolheu outro fornecedor  ' },
    });
    fireEvent.click(confirmar);
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/leads/lead-1/etapa', {
        funilEtapaId: 'e-perdido',
        motivo: 'Escolheu outro fornecedor',
      }),
    );
  });

  it('cancelar a janela do motivo não move o lead', () => {
    render(<EtapaDoLead leadId="lead-1" />);
    fireEvent.change(screen.getByTestId('inbox-etapa-lead'), { target: { value: 'e-perdido' } });
    fireEvent.click(screen.getByText('Cancelar'));
    expect(put).not.toHaveBeenCalled();
    expect(screen.queryByTestId('inbox-etapa-motivo')).toBeNull();
  });

  it('sem permissão de editar o funil: mostra a etapa, travada', () => {
    estado.perm = { ver: true, editar: false };
    render(<EtapaDoLead leadId="lead-1" />);
    expect((screen.getByTestId('inbox-etapa-lead') as HTMLSelectElement).disabled).toBe(true);
  });

  it('sem permissão de ver o funil: não aparece', () => {
    estado.perm = { ver: false, editar: false };
    render(<EtapaDoLead leadId="lead-1" />);
    expect(screen.queryByTestId('inbox-etapa-lead')).toBeNull();
  });
});
