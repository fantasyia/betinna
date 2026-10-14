import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** Encaixe na OP: grade, peças de cada tamanho no risco, fila e o .plt. */

const estado = vi.hoisted(() => ({ jobs: [] as unknown[], regras: null as unknown }));
const apiPost = vi.fn();
const baixar = vi.fn();
vi.mock('@/hooks/useApiQuery', () => ({
  // Regras do modelo (tem ribana?) e a lista de riscos da OP.
  useApiQuery: (path: string) => ({
    data: path.endsWith('/encaixe') ? { regras: estado.regras } : estado.jobs,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
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

const montar = (risco: Parameters<typeof EncaixeDaOp>[0]['risco'] = null) =>
  render(
    <MemoryRouter>
      <EncaixeDaOp opId="op-1" numero="OP-0001" modeloId="m-1" itens={itens} risco={risco} />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  apiPost.mockReset();
  baixar.mockReset();
  estado.jobs = [];
  estado.regras = null;
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
  it('risco MESCLADO (14/10): todas as grades da OP, 1 de cada tamanho por padrão', async () => {
    apiPost.mockResolvedValue({});
    montar();
    fireEvent.change(screen.getByTestId('encaixe-qtd-Regular-M'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('encaixe-gerar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][0]).toBe('/erp/ops/op-1/encaixes');
    expect(apiPost.mock.calls[0][1]).toEqual({
      modeloLinhaId: 'ml-inf',
      material: 'TECIDO',
      composicao: [
        { modeloLinhaId: 'ml-inf', tamanho: '4', quantidade: 1 },
        { modeloLinhaId: 'ml-reg', tamanho: 'P', quantidade: 1 },
        { modeloLinhaId: 'ml-reg', tamanho: 'M', quantidade: 2 },
        { modeloLinhaId: 'ml-reg', tamanho: 'G', quantidade: 1 },
      ],
      tempoMin: 30,
    });
  });

  it('zerando uma grade, o risco sai só com a outra', async () => {
    apiPost.mockResolvedValue({});
    montar();
    fireEvent.change(screen.getByTestId('encaixe-qtd-Infantil-4'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('encaixe-gerar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][1].modeloLinhaId).toBe('ml-reg');
    expect(apiPost.mock.calls[0][1].composicao.map((c: { tamanho: string }) => c.tamanho)).toEqual(['P', 'M', 'G']);
  });

  it('ribana (14/10): o botão só aparece com ribana na ficha e pede com a MESMA grade', async () => {
    montar();
    expect(screen.queryByTestId('encaixe-gerar-ribana')).toBeNull();
    cleanup();
    estado.regras = { ribana: { tecido: 'TUBULAR', larguraUtilMm: 580 } };
    apiPost.mockResolvedValue({});
    montar();
    fireEvent.change(screen.getByTestId('encaixe-qtd-Infantil-4'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('encaixe-gerar-ribana'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][1]).toMatchObject({
      modeloLinhaId: 'ml-reg',
      material: 'RIBANA',
      composicao: [
        { tamanho: 'P', quantidade: 1 },
        { tamanho: 'M', quantidade: 1 },
        { tamanho: 'G', quantidade: 1 },
      ],
    });
  });

  it('trava por material: tecido na fila não trava a ribana (e vice-versa)', () => {
    estado.regras = { ribana: { tecido: 'TUBULAR', larguraUtilMm: 580 } };
    estado.jobs = [
      {
        id: 'j1',
        status: 'RODANDO',
        tempoMin: 30,
        linha: 'Regular',
        composicao: [],
        codigoMolde: '107',
        progresso: null,
        resultado: null,
        erro: null,
        agente: null,
        pegoEm: null,
        concluidoEm: null,
        criadoEm: '2026-10-14T18:00:00Z',
        atualizadoEm: '2026-10-14T18:00:00Z',
        arquivos: [],
      },
    ];
    montar();
    expect((screen.getByTestId('encaixe-gerar') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('encaixe-gerar-ribana') as HTMLButtonElement).disabled).toBe(false);
  });

  it('OP montada pela GRADE DO RISCO (Léo, 14/10): o risco já vem com a grade dela', async () => {
    apiPost.mockResolvedValue({});
    montar({
      linha: 'Regular',
      composicao: [
        { tamanho: 'M', quantidade: 2 },
        { tamanho: 'G', quantidade: 1 },
      ],
      cores: [{ cor: 'Preto', grades: 20 }],
    });
    // Abre na linha da grade, sem precisar escolher nem digitar nada.
    fireEvent.click(screen.getByTestId('encaixe-gerar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][1]).toMatchObject({
      modeloLinhaId: 'ml-reg',
      composicao: [
        { tamanho: 'M', quantidade: 2 },
        { tamanho: 'G', quantidade: 1 },
      ],
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
