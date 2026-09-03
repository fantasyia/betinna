import { describe, expect, it } from 'vitest';
import { variaveisDoContrato } from './contrato-variaveis.util';

/**
 * Este mapa é o contrato entre a proposta e o documento: nome de variável aqui
 * tem que bater com o `{{...}}` do modelo. Errar não quebra nada — o campo sai
 * vazio e só se descobre lendo o PDF assinado.
 */
const base = {
  numero: 'PROP-0042',
  valor: 1566,
  criadoEm: new Date('2026-09-03T12:00:00Z'),
  validoAte: null,
  clienteNome: 'INDÚSTRIA EXEMPLO LTDA',
  itens: [
    {
      sku: 'MB-05',
      produtoNome: 'Master Block MB-05',
      quantidade: 3,
      precoUnitario: 522,
      total: 1566,
    },
  ],
};

describe('variáveis do contrato', () => {
  it('leva razão social, número e valor pros campos do documento', () => {
    const v = variaveisDoContrato(base);

    expect(v.razao_social).toBe('INDÚSTRIA EXEMPLO LTDA');
    expect(v.numero_proposta).toBe('PROP-0042');
    expect(v.total_mensal).toBe('R$ 1.566,00');
    expect(v.aluguel_mensal).toBe('R$ 1.566,00');
  });

  it('escreve a data por extenso, como o contrato pede', () => {
    expect(variaveisDoContrato(base).data_extenso).toBe('3 de setembro de 2026');
  });

  it('a tabela de preços recebe SKU, unitário, quantidade e total', () => {
    const v = variaveisDoContrato(base);

    expect(v.p1_item).toBe('MB-05');
    expect(v.p1_unit).toBe('R$ 522,00');
    expect(v.p1_qtd).toBe('3');
    expect(v.p1_total).toBe('R$ 1.566,00');
  });

  it('linha de tabela sem item vai VAZIA, não ausente', () => {
    // Variável não enviada some do documento e costura o texto errado; string
    // vazia deixa a linha em branco, que é o certo.
    const v = variaveisDoContrato(base);

    expect(v.p2_item).toBe('');
    expect(v.p5_total).toBe('');
    expect(Object.prototype.hasOwnProperty.call(v, 'p3_qtd')).toBe(true);
  });

  it('separa filtro híbrido de hardware IoT pelo sufixo do SKU', () => {
    const v = variaveisDoContrato({
      ...base,
      itens: [
        { sku: 'MB-05', produtoNome: 'MB-05', quantidade: 1, precoUnitario: 522, total: 522 },
        {
          sku: 'MB-05_D.S.',
          produtoNome: 'MB-05 Data Sense',
          quantidade: 1,
          precoUnitario: 900,
          total: 900,
        },
      ],
    });

    // Cláusula 5 lista SÓ os filtros na primeira tabela.
    expect(v.f1_modelo).toBe('MB-05');
    expect(v.f2_modelo).toBe('');
    // A tabela de preços lista os dois, na ordem da proposta.
    expect(v.p1_item).toBe('MB-05');
    expect(v.p2_item).toBe('MB-05_D.S.');
  });

  it('sem validade explícita, usa 15 dias a partir da proposta', () => {
    expect(variaveisDoContrato(base).validade).toBe('18/09/2026');
  });

  it('validade explícita manda', () => {
    const v = variaveisDoContrato({ ...base, validoAte: new Date('2026-10-01T12:00:00Z') });

    expect(v.validade).toBe('01/10/2026');
  });

  it('o que o app não tem vai vazio, e não como texto de exemplo', () => {
    const v = variaveisDoContrato(base);

    for (const k of ['f1_tag', 'f1_tensao', 's1_unit', 'servicos_total', 'prazo_entrega']) {
      expect(v[k]).toBe('');
    }
  });
});
