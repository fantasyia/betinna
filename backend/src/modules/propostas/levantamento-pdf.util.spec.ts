import { describe, expect, it } from 'vitest';
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

/** O texto que o pdfkit escreveu (sem compressão): as strings hex dos TJ, em WinAnsi. */
function textoDo(pdf: Buffer): string {
  const bruto = pdf.toString('latin1');
  const pedacos: string[] = [];
  for (const tj of bruto.matchAll(/\[(.*?)\] TJ/g)) {
    const linha = [...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)]
      .map((m) => Buffer.from(m[1], 'hex').toString('latin1'))
      .join('');
    pedacos.push(linha);
  }
  return pedacos.join('\n');
}

describe('desenharLevantamento', () => {
  it('é um PDF, com o título, o número e os valores da página de aceite', async () => {
    const pdf = await desenharLevantamento(RESUMO, MARCA, { comprimir: false });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const t = textoDo(pdf);
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

  it('sem serviços, não desenha a tabela de serviços', async () => {
    const pdf = await desenharLevantamento(
      { ...RESUMO, servicos: { customizacao: null, total: null, parcelas: 2, valorParcela: null } },
      MARCA,
      { comprimir: false },
    );
    expect(textoDo(pdf)).not.toContain('SERVIÇOS DE IMPLANTAÇÃO');
  });

  it('muitos quadros: quebra em páginas, e toda página tem o rodapé', async () => {
    const quadros = Array.from({ length: 30 }, (_, i) => ({
      ...RESUMO.quadros[1],
      quadro: `Quadro ${i + 1}`,
    }));
    const pdf = await desenharLevantamento({ ...RESUMO, quadros }, MARCA, { comprimir: false });
    const t = textoDo(pdf);
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
    expect(textoDo(pdf)).toContain('Empresa X');
  });

  it('escurecer: primária mais funda pro cabeçalho; hex inválido volta igual', () => {
    expect(escurecer('#FFFFFF', 0.5)).toBe('#808080');
    expect(escurecer('azul', 0.5)).toBe('azul');
  });
});
