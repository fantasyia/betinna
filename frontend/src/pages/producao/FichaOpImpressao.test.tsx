import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { FichaOp, type DadosImpressao } from './FichaOpImpressaoPage';

/** Ficha da OP impressa (Léo, 14/10): 3 vias e cada item na via certa. */

afterEach(cleanup);

const g = (cor: string, tamanho: string, tamanhoOrdem: number, planejada: number) => ({
  modeloLinhaId: 'ml-reg',
  linha: 'Regular',
  linhaOrdem: 1,
  cor,
  corHex: null,
  corOrdem: cor === 'Preto' ? 0 : 1,
  tamanho,
  tamanhoOrdem,
  planejada,
  cortada: null,
});

const D: DadosImpressao = {
  empresa: 'Ribelt',
  op: { numero: 'OP-0007', criadoEm: '2026-10-14T12:00:00Z', prazo: null, faccao: 'Facção Ana', precoFaccaoPorPeca: 4, observacoes: 'Costura reforçada no gancho' },
  modelo: { nome: 'Bermuda Moletom', codigoMolde: '100', tecido: 'Moletom', larguraUtilMm: 1700, ribana: null },
  grade: [g('Preto', 'P', 0, 20), g('Preto', 'M', 1, 40), g('Bege', 'M', 1, 20), g('Bege', 'G', 2, 20)],
  fichas: [
    {
      modeloLinhaId: 'ml-reg',
      linha: 'Regular',
      observacoes: null,
      tabelaMedidas: { colunas: ['Cintura'], linhas: [{ tamanho: 'M', valores: ['40'] }] },
      acabamento: [{ id: 'passar-cordao', nome: 'Passar cordão', preco: 0.25 }],
      itens: [
        { nome: 'Moletom', tipo: 'TECIDO', unidade: 'KG', consumoPorPeca: 0.12, porTamanho: null, etapa: 'FACCAO', observacao: null },
        { nome: 'Elástico de embutir 45 mm', tipo: 'AVIAMENTO', unidade: 'METRO', consumoPorPeca: 0.8, porTamanho: { P: 0.76, G: 0.84 }, etapa: 'FACCAO', observacao: null },
        { nome: 'Cordão', tipo: 'AVIAMENTO', unidade: 'METRO', consumoPorPeca: 1.2, porTamanho: null, etapa: 'ACABAMENTO', observacao: null },
      ],
    },
  ],
  riscos: [{ material: 'TECIDO', linha: 'Regular', composicao: [{ tamanho: 'M', quantidade: 4 }], resultado: { comprimentoM: 3.1, aproveitamento: 0.82 } }],
};

describe('FichaOp', () => {
  it('3 vias, cada uma com o cabeçalho e a grade', () => {
    render(<FichaOp d={D} />);
    expect(screen.getAllByText('OP-0007 · Bermuda Moletom')).toHaveLength(3);
    for (const v of ['CORTE', 'FACÇÃO', 'ACABAMENTO']) expect(screen.getByText(v)).toBeTruthy();
  });

  it('corte: enfesto por cor; facção leva o elástico (total por tamanho); acabamento leva o cordão', () => {
    const { container } = render(<FichaOp d={D} />);
    const [corte, faccao, acab] = [...container.querySelectorAll('section.via')] as HTMLElement[];
    expect(within(corte).getAllByText('46,5 m')).toHaveLength(2); // Preto: 15 folhas × 3,1 m (sem viés: risco = total)
    expect(within(faccao).getByText('80 m')).toBeTruthy(); // 20×0,76 + 60×0,8 + 20×0,84 = 80
    expect(within(faccao).queryByText('Cordão')).toBeNull();
    expect(within(acab).getByText('Cordão')).toBeTruthy();
    expect(within(acab).getByText('Passar cordão')).toBeTruthy();
    expect(within(faccao).getByText('Costura reforçada no gancho')).toBeTruthy();
  });
});
