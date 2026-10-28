import { describe, expect, it } from 'vitest';
import { fichaDoModelo } from './conhecimento-vitrine';

const modelo = {
  nome: 'Bermuda de Moletom',
  slug: 'bermuda-moletom-summer',
  descricao: 'Bermuda leve, até o joelho.',
  composicao: '50% algodão, 50% poliéster',
  cores: [{ cor: { nome: 'Preto' } }, { cor: { nome: 'Bege' } }],
  linhas: [
    {
      linha: { nome: 'Masculino' },
      precoEntrada: '18.99',
      precoVolume: '17.49',
      precoAtacadao: null,
      precoSugerido: '39.99',
      tabelaMedidas: {
        colunas: ['cintura', 'comprimento'],
        linhas: [{ tamanho: 'M', valores: ['40', '50'] }],
      },
      tamanhos: [{ tamanho: { nome: 'G', ordem: 3 } }, { tamanho: { nome: 'M', ordem: 2 } }],
    },
  ],
};

describe('fichaDoModelo (24/10)', () => {
  it('monta a ficha do robô a partir do cadastro', () => {
    const f = fichaDoModelo(
      modelo,
      { minimoEntrada: 50, minimoVolume: 200, minimoAtacadao: 1000 },
      'https://atacado.ribelt.com.br/',
    );
    expect(f.titulo).toBe('Produto · Bermuda de Moletom');
    expect(f.conteudo).toContain(
      'Link do produto: https://atacado.ribelt.com.br/p/bermuda-moletom-summer',
    );
    expect(f.conteudo).toContain('Cores: Preto, Bege.');
    expect(f.conteudo).toContain('tamanhos M, G');
    expect(f.conteudo).toContain('R$ 18,99 por peça a partir de 50 peças (Entrada)');
    expect(f.conteudo).toContain('R$ 17,49 a partir de 200 peças (Volume)');
    expect(f.conteudo).not.toContain('Atacadão');
    expect(f.conteudo).toContain('lucro de R$ 21,00 por peça');
    expect(f.conteudo).toContain('M: cintura 40, comprimento 50');
  });

  it('a observação da tabela de medidas vai junto (28/10)', () => {
    const nota = 'Medidas da peça deitada, em cm (a volta inteira é o dobro).';
    const f = fichaDoModelo(
      {
        ...modelo,
        linhas: [
          {
            ...modelo.linhas[0],
            tabelaMedidas: { ...modelo.linhas[0].tabelaMedidas, nota },
          },
        ],
      },
      { minimoEntrada: null, minimoVolume: null, minimoAtacadao: null },
      null,
    );
    expect(f.conteudo).toContain(`M: cintura 40, comprimento 50. (${nota})`);
  });

  it('sem preço = sob consulta; sem domínio = sem link', () => {
    const f = fichaDoModelo(
      {
        ...modelo,
        linhas: [
          { ...modelo.linhas[0], precoEntrada: null, precoVolume: null, precoSugerido: null },
        ],
      },
      { minimoEntrada: null, minimoVolume: null, minimoAtacadao: null },
      null,
    );
    expect(f.conteudo).toContain('preço sob consulta');
    expect(f.conteudo).not.toContain('Link do produto');
  });
});
