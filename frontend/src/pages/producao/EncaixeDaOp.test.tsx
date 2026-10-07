import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** Encaixe na OP: grade, peças de cada tamanho no risco, fila e o .plt. */

const estado = vi.hoisted(() => ({ jobs: [] as unknown[] }));
const apiPost = vi.fn();
const baixar = vi.fn();
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: estado.jobs, loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a) },
  apiErrorMessage: (e: unknown) => String(e),
  buscarArquivo: vi.fn().mockResolvedValue(new Blob(['png'])),
  downloadFile: (...a: unknown[]) => baixar(...a),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { EncaixeDaOp, gradesDaOp, type ItemDaGrade } from './EncaixeDaOp';

const item = (
  linha: string,
  ml: string,
  tamanho: string,
  ordem: number,
  planejada = 10,
): ItemDaGrade => ({
  modeloLinhaId: ml,
  linha,
  linhaOrdem: ml === 'ml-reg' ? 1 : 0,
  tamanho,
  tamanhoOrdem: ordem,
  planejada,
});
const itens = [
  item('Regular', 'ml-reg', 'G', 2),
  item('Regular', 'ml-reg', 'P', 0),
  item('Regular', 'ml-reg', 'M', 1),
  item('Regular', 'ml-reg', 'M', 1), // outra cor, mesmo tamanho
  item('Infantil', 'ml-inf', '4', 1),
  item('Infantil', 'ml-inf', '2', 0, 0), // sem peça planejada: fora
];

const montar = () =>
  render(
    <MemoryRouter>
      <EncaixeDaOp opId="op-1" numero="OP-0001" modeloId="m-1" itens={itens} />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  apiPost.mockReset();
  baixar.mockReset();
  estado.jobs = [];
});

describe('gradesDaOp', () => {
  it('uma grade por linha, tamanhos na ordem da grade, só os planejados', () => {
    expect(gradesDaOp(itens)).toEqual([
      { modeloLinhaId: 'ml-inf', linha: 'Infantil', tamanhos: ['4'] },
      { modeloLinhaId: 'ml-reg', linha: 'Regular', tamanhos: ['P', 'M', 'G'] },
    ]);
  });
});

describe('<EncaixeDaOp>', () => {
  it('pede o risco com 1 de cada tamanho (padrão) e o tempo escolhido', async () => {
    apiPost.mockResolvedValue({});
    montar();
    fireEvent.change(screen.getByTestId('encaixe-grade'), { target: { value: 'ml-reg' } });
    fireEvent.change(screen.getByTestId('encaixe-qtd-M'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('encaixe-gerar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][0]).toBe('/erp/ops/op-1/encaixes');
    expect(apiPost.mock.calls[0][1]).toEqual({
      modeloLinhaId: 'ml-reg',
      composicao: [
        { tamanho: 'P', quantidade: 1 },
        { tamanho: 'M', quantidade: 2 },
        { tamanho: 'G', quantidade: 1 },
      ],
      tempoMin: 30,
    });
  });

  it('com risco na fila: não deixa pedir outro; pronto: baixa o .plt', () => {
    estado.jobs = [
      {
        id: 'j-2',
        status: 'RODANDO',
        tempoMin: 30,
        linha: 'Regular',
        composicao: [{ tamanho: 'P', quantidade: 1 }],
        codigoMolde: '100',
        progresso: { comprimentoM: 1.984, aproveitamento: 85.7 },
        resultado: null,
        erro: null,
        arquivos: [],
        atualizadoEm: '2026-10-08T12:00:00Z',
      },
      {
        id: 'j-1',
        status: 'CONCLUIDO',
        tempoMin: 30,
        linha: 'Regular',
        composicao: [{ tamanho: 'P', quantidade: 1 }],
        codigoMolde: '100',
        progresso: null,
        resultado: { comprimentoM: 1.9, aproveitamento: 86 },
        erro: null,
        arquivos: [{ tipo: 'PLT', tamanho: 10, em: '2026-10-08T11:00:00Z' }],
        atualizadoEm: '2026-10-08T11:00:00Z',
      },
    ];
    montar();
    expect((screen.getByTestId('encaixe-gerar') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('encaixe-j-2').textContent).toMatch(/1,984 m/);
    fireEvent.click(screen.getByTestId('encaixe-plt-j-1'));
    expect(baixar).toHaveBeenCalledWith('/erp/encaixes/j-1/arquivos/PLT', 'OP-0001-Regular.plt');
  });
});
