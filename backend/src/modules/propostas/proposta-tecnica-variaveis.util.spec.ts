import { describe, expect, it } from 'vitest';
import {
  MAX_LINHAS,
  PropostaTecnicaIncompleta,
  type PropostaTecnica,
  linhasDoItem,
  porExtenso,
  variaveisDaPropostaTecnica,
} from './proposta-tecnica-variaveis.util';

/**
 * Anexo II — "Proposta Técnica para implementação do Sistema Master Block IoT".
 * Variáveis cravadas do documento que o Léo mandou em 18/09.
 *
 * O que estes testes protegem não é formatação: é o documento sair COMPLETO.
 * Proposta técnica com um quadro a menos é um quadro que fica sem supressor — e
 * ninguém percebe, porque o papel parece certo.
 */
const BASE: PropostaTecnica = {
  numero: 'PROP-0042',
  emitidaEm: new Date('2026-09-18T12:00:00'),
  validoAte: new Date('2026-10-18T12:00:00'),
  clienteNome: 'INDÚSTRIA EXEMPLO LTDA',
  cnpj: '16774052000155',
  endereco: {
    logradouro: 'Rua XV de Novembro',
    numero: '100',
    complemento: 'sala 2',
    bairro: 'Centro',
    cidade: 'Joinville',
    uf: 'SC',
  },
  prazoEntregaDias: 45,
  prazoInstalacaoDias: 15,
  prazoSoftwareDias: 7,
  linhas: [
    { quadroPainel: 'QGBT', tensaoV: 380, modelo: 'MB-04', secao: 'SUPRESSOR' },
    { quadroPainel: 'Painel 3', tensaoV: 220, modelo: 'MB-01', secao: 'SUPRESSOR' },
    { quadroPainel: 'QGBT', tensaoV: 380, modelo: 'Data Sense', secao: 'HARDWARE' },
  ],
};

describe('cabeçalho do Anexo II', () => {
  it('preenche os campos da tabela de identificação', () => {
    const v = variaveisDaPropostaTecnica(BASE);
    expect(v.razao_social).toBe('INDÚSTRIA EXEMPLO LTDA');
    expect(v.cnpj).toBe('16.774.052/0001-55');
    expect(v.endereco_completo).toBe('Rua XV de Novembro, n. 100, sala 2, Centro, Joinville-SC');
    expect(v.data_emissao_extenso).toBe('18 de setembro de 2026');
    expect(v.validade).toBe('18/10/2026');
  });

  /**
   * 📌 O documento tem "Proposta n. PT-" e "Proposta Comercial de referência:
   * PC-". O Léo decidiu que é UM documento só, então os dois recebem o mesmo
   * número — os campos continuam porque o texto é do jurídico.
   */
  it('PT e PC recebem o MESMO número', () => {
    const v = variaveisDaPropostaTecnica(BASE);
    expect(v.proposta_pt).toBe('PROP-0042');
    expect(v.proposta_pc).toBe('PROP-0042');
  });

  it('proposta sem validade não inventa data', () => {
    const v = variaveisDaPropostaTecnica({ ...BASE, validoAte: null });
    expect(v.validade).toBe('');
  });

  it('CNPJ malformado passa como veio, sem mascarar errado', () => {
    expect(variaveisDaPropostaTecnica({ ...BASE, cnpj: '123' }).cnpj).toBe('123');
    expect(variaveisDaPropostaTecnica({ ...BASE, cnpj: null }).cnpj).toBe('');
  });
});

describe('prazos do item 04', () => {
  it('escreve número e extenso — o documento pede os dois', () => {
    const v = variaveisDaPropostaTecnica(BASE);
    expect(v.prazo_entrega).toBe('45');
    expect(v.prazo_entrega_extenso).toBe('quarenta e cinco');
    expect(v.prazo_instalacao_extenso).toBe('quinze');
    expect(v.prazo_software_extenso).toBe('sete');
  });

  /**
   * Prazo ausente sai VAZIO, não com um número padrão. Um prazo que o sistema
   * escolheu sairia impresso num documento que alguém assina, e ninguém saberia
   * que não foi combinado.
   */
  it('prazo não definido fica em branco', () => {
    const v = variaveisDaPropostaTecnica({ ...BASE, prazoEntregaDias: null });
    expect(v.prazo_entrega).toBe('');
    expect(v.prazo_entrega_extenso).toBe('');
  });

  it.each([
    [0, ''],
    [1, 'um'],
    [10, 'dez'],
    [15, 'quinze'],
    [20, 'vinte'],
    [21, 'vinte e um'],
    [30, 'trinta'],
    [45, 'quarenta e cinco'],
    [90, 'noventa'],
    [99, 'noventa e nove'],
    [100, 'cem'],
  ])('%i por extenso = %s', (n, esperado) => {
    expect(porExtenso(n)).toBe(esperado);
  });

  it('acima de 100 devolve o número — prazo de 3 dígitos é erro de digitação', () => {
    expect(porExtenso(365)).toBe('365');
  });
});

describe('tabelas 3.1 e 3.2', () => {
  it('numera os itens e separa supressores de hardwares', () => {
    const v = variaveisDaPropostaTecnica(BASE);
    expect(v.sup_01_quadro).toBe('QGBT');
    expect(v.sup_01_tensao).toBe('380V');
    expect(v.sup_01_modelo).toBe('MB-04');
    expect(v.sup_02_modelo).toBe('MB-01');
    // O hardware tem tabela PRÓPRIA no documento, com sua própria numeração.
    expect(v.hw_01_modelo).toBe('Data Sense');
    expect(v.hw_01_quadro).toBe('QGBT');
  });

  /**
   * 🔴 Linha não usada precisa existir e estar VAZIA.
   *
   * Variável ausente no ClickSign não some: ela é impressa literalmente como
   * `{{sup_09_quadro}}` no documento que vai pro cliente.
   */
  it('as linhas sobrando existem, vazias', () => {
    const v = variaveisDaPropostaTecnica(BASE);
    for (let i = 3; i < MAX_LINHAS; i++) {
      const n = String(i + 1).padStart(2, '0');
      expect(v[`sup_${n}_quadro`]).toBe('');
      expect(v[`sup_${n}_modelo`]).toBe('');
      expect(v[`sup_${n}_item`]).toBe('');
    }
    // E existem de verdade — não é `undefined` disfarçado.
    expect(Object.keys(v)).toContain(`sup_${String(MAX_LINHAS).padStart(2, '0')}_modelo`);
  });

  /**
   * ⛔ Estourar é melhor que truncar: um quadro cortado do documento é um
   * quadro que fica sem proteção, e o papel não denuncia.
   */
  it('RECUSA quando há mais quadros que linhas no modelo', () => {
    const muitos = Array.from({ length: MAX_LINHAS + 1 }, (_, i) => ({
      quadroPainel: `Q${i}`,
      tensaoV: 380,
      modelo: 'MB-01',
      secao: 'SUPRESSOR' as const,
    }));
    expect(() => variaveisDaPropostaTecnica({ ...BASE, linhas: muitos })).toThrow(
      PropostaTecnicaIncompleta,
    );
  });

  it('exatamente no teto ainda passa', () => {
    const noLimite = Array.from({ length: MAX_LINHAS }, (_, i) => ({
      quadroPainel: `Q${i}`,
      tensaoV: 380,
      modelo: 'MB-01',
      secao: 'SUPRESSOR' as const,
    }));
    expect(() => variaveisDaPropostaTecnica({ ...BASE, linhas: noLimite })).not.toThrow();
  });
});

/**
 * 🔴 UM item de catálogo pode virar DUAS linhas do documento.
 *
 * `MB-04_D.S.` é um produto só, com um preço só (R$ 874 contra R$ 425 do puro —
 * a diferença É o hardware). No papel ele aparece separado: o supressor na
 * tabela 3.1 e o Data Sense na 3.2.
 */
describe('linhasDoItem', () => {
  it('Master Block puro vira UMA linha, só de supressor', () => {
    const l = linhasDoItem({ sku: 'MB-04', quadroPainel: 'QGBT', tensaoV: 380 });
    expect(l).toEqual([
      { quadroPainel: 'QGBT', tensaoV: 380, modelo: 'MB-04', secao: 'SUPRESSOR' },
    ]);
  });

  it('Data Sense vira DUAS: o MB na 3.1 e o hardware na 3.2', () => {
    const l = linhasDoItem({ sku: 'MB-04_D.S.', quadroPainel: 'QGBT', tensaoV: 380 });
    expect(l).toHaveLength(2);
    // Na coluna MODELO da 3.1 vai o MB puro, sem o sufixo do catálogo.
    expect(l[0]).toMatchObject({ modelo: 'MB-04', secao: 'SUPRESSOR' });
    expect(l[1]).toMatchObject({ modelo: 'Data Sense', secao: 'HARDWARE' });
    // As duas linhas falam do MESMO quadro.
    expect(l[1].quadroPainel).toBe('QGBT');
  });

  it('End Point idem', () => {
    const l = linhasDoItem({ sku: 'MB-01_E.P.', quadroPainel: 'Painel 3', tensaoV: 220 });
    expect(l.map((x) => x.modelo)).toEqual(['MB-01', 'End Point']);
  });

  it('item sem SKU não quebra', () => {
    expect(linhasDoItem({ sku: null, quadroPainel: 'Q', tensaoV: 380 })).toEqual([
      { quadroPainel: 'Q', tensaoV: 380, modelo: '', secao: 'SUPRESSOR' },
    ]);
  });
});
