import { describe, expect, it } from 'vitest';
// pdf.js já vem no node_modules pelo officeparser (dependência de produção).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { desenharLevantamento, escurecer } from './levantamento-pdf.util';
import type { ResumoProposta } from './proposta-resumo.util';

/**
 * O PDF do "Levantamento técnico de projeto" (Léo, 25/09): o app gera, com os
 * mesmos dados da página de aceite, e ele vai anexado no envelope.
 */

const RESUMO: ResumoProposta = {
  numero: 'PROP-0028',
  criadaEm: '2026-09-25T15:00:00.000Z',
  validoAte: '2026-10-24T00:00:00.000Z',
  cliente: {
    razaoSocial: 'INDÚSTRIA TESTE CONTRATO LTDA',
    cnpj: '76.851.812/0001-02',
    endereco: 'Avenida Paulista, 1000 · Bela Vista · São Paulo/SP · CEP 01310-100',
  },
  signatarioNome: 'Marina Torres Aguiar',
  quadros: [
    {
      quadro: 'QGBT',
      principal: true,
      tensaoV: 380,
      correnteA: 420,
      modelo: 'Modelo A + Concentrador',
      aluguelMensal: 874,
    },
    {
      quadro: 'Painel Iluminação',
      principal: false,
      tensaoV: 220,
      correnteA: 63,
      modelo: 'Modelo B',
      aluguelMensal: 121,
    },
  ],
  aluguelMensalTotal: 995,
  condicoes: { vigenciaMeses: 60, diaVencimento: 5, primeiroAluguelNoMes: 2, garantiaMeses: 60 },
  servicos: {
    customizacao: { quantidade: 1, unitario: 1500, total: 1500 },
    total: 12000,
    parcelas: 2,
    valorParcela: 6000,
  },
  prazos: { entregaDias: 45, instalacaoDias: 15, verificacaoDias: 5, softwareDias: 7 },
};
const MARCA = {
  nome: 'Empresa X',
  primaria: '#00416E',
  secundaria: '#008CC8',
  acao: '#F39200',
  logoNegativo: null,
  logo: null,
  rodape: 'Empresa X · CNPJ 00 · contato@x',
};

/**
 * O texto do PDF, um trecho desenhado por linha — lido pelo pdf.js, como um
 * leitor de verdade. Com fonte EMBUTIDA o pdfkit escreve ids de glifo (e o
 * mapa ToUnicode), não mais o texto em WinAnsi: decodificar os TJ na mão não
 * serve.
 */
async function textoDo(pdf: Buffer): Promise<string> {
  const tarefa = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false });
  const d = await tarefa.promise;
  const pedacos: string[] = [];
  for (let i = 1; i <= d.numPages; i++) {
    const conteudo = await (await d.getPage(i)).getTextContent();
    for (const item of conteudo.items) {
      if ('str' in item && item.str.trim()) pedacos.push(item.str);
    }
  }
  await tarefa.destroy();
  return pedacos.join('\n');
}

describe('desenharLevantamento', () => {
  it('é um PDF, com o título, o número e os valores da página de aceite', async () => {
    const pdf = await desenharLevantamento(RESUMO, MARCA, { comprimir: false });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const t = await textoDo(pdf);
    expect(t).toContain('Levantamento técnico de projeto');
    expect(t).toContain('PROP-0028');
    expect(t).toContain('INDÚSTRIA TESTE CONTRATO LTDA');
    expect(t).toContain('R$ 995,00');
    expect(t).toContain('R$ 12.000,00');
    expect(t).toContain('Pago em 2 parcelas de R$ 6.000,00.');
    expect(t).toContain('dia 05');
    expect(t).toContain('24/10/2026'); // validade sem fuso
    expect(t).toContain('principal');
    expect(t).toContain('contato@x'); // rodapé do tenant
  });

  /** Revisão 25/09: "TENSÃ/O" e "CORRENT/E" quebravam no meio da palavra. */
  it('coluna de número NÃO quebra: título e valor inteiros, mesmo com número grande', async () => {
    const pdf = await desenharLevantamento(
      {
        ...RESUMO,
        quadros: [
          {
            quadro: 'Quadro Geral de Baixa Tensão da Subestação Norte — Ala de Envase',
            principal: true,
            tensaoV: 13800,
            correnteA: 1250,
            modelo: 'Modelo A + Concentrador',
            aluguelMensal: 111111.78,
          },
        ],
      },
      MARCA,
      { comprimir: false },
    );
    const linhas = (await textoDo(pdf)).split('\n');
    for (const inteiro of [
      'TENSÃO',
      'CORRENTE',
      'ALUGUEL MENSAL',
      '13800 V',
      '1250 A',
      'R$ 111.111,78',
    ]) {
      expect(linhas).toContain(inteiro);
    }
  });

  it('sem serviços, não desenha a tabela de serviços', async () => {
    const pdf = await desenharLevantamento(
      { ...RESUMO, servicos: { customizacao: null, total: null, parcelas: 2, valorParcela: null } },
      MARCA,
      { comprimir: false },
    );
    expect(await textoDo(pdf)).not.toContain('SERVIÇOS DE IMPLANTAÇÃO');
  });

  it('muitos quadros: quebra em páginas, e toda página tem o rodapé', async () => {
    const quadros = Array.from({ length: 30 }, (_, i) => ({
      ...RESUMO.quadros[1],
      quadro: `Quadro ${i + 1}`,
    }));
    const pdf = await desenharLevantamento({ ...RESUMO, quadros }, MARCA, { comprimir: false });
    const t = await textoDo(pdf);
    expect(t).toContain('Quadro 30');
    const paginas = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(paginas).toBeGreaterThan(1);
    expect(t.split('contato@x').length - 1).toBe(paginas);
  });

  it('logo inválida não derruba: cai no nome da empresa em texto', async () => {
    const pdf = await desenharLevantamento(
      RESUMO,
      { ...MARCA, logoNegativo: Buffer.from('não é imagem') },
      { comprimir: false },
    );
    expect(await textoDo(pdf)).toContain('Empresa X');
  });

  /** Léo, 28/09: o PDF com as fontes da página de aceite, não Helvetica. */
  it('fontes da página: Poppins nos títulos e Source Sans 3 no texto, embutidas', async () => {
    const pdf = await desenharLevantamento(RESUMO, MARCA, { comprimir: false });
    const fontes = [
      ...pdf.toString('latin1').matchAll(/\/BaseFont \/(?:[A-Z]{6}\+)?([\w-]+)/g),
    ].map((m) => m[1]);
    expect(fontes).toEqual(
      expect.arrayContaining(['Poppins-SemiBold', 'SourceSans3-Regular', 'SourceSans3-Semibold']),
    );
    expect(fontes.filter((f) => f.startsWith('Helvetica'))).toEqual([]);
  });

  it('escurecer: primária mais funda pro cabeçalho; hex inválido volta igual', () => {
    expect(escurecer('#FFFFFF', 0.5)).toBe('#808080');
    expect(escurecer('azul', 0.5)).toBe('azul');
  });
});
