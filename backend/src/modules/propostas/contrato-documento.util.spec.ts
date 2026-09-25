import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PizZip from 'pizzip';
import { DOMParser } from '@xmldom/xmldom';
import {
  CAMINHO_MODELO,
  carregarModelo,
  dadosDoDocumento,
  renderizarDocumento,
  TERMOS_DO_CONTRATO,
  VariavelDesconhecidaNoModelo,
  type DadosDocumentoContrato,
  type DocumentoContratoEntrada,
  type LinhaLevantamento,
} from './contrato-documento.util';
import { porExtenso } from './proposta-tecnica-variaveis.util';

/**
 * O documento único do Anexo I, montado pelo app.
 *
 * Os testes de render usam o MODELO REAL do repo, não um .docx de brinquedo:
 * o que importa é que o arquivo que vai pro cliente não tenha sobra de
 * `{{variável}}`, "undefined" nem linha de tabela faltando.
 */

const quadro = (n: number, sku = 'MB-04', total = 425): LinhaLevantamento => ({
  quadroPainel: `Painel ${n}`,
  tensaoV: 220,
  correnteA: 60 + n,
  sku,
  quantidade: 1,
  total,
});

function entrada(extra: Partial<DocumentoContratoEntrada> = {}): DocumentoContratoEntrada {
  return {
    numero: 'PROP-0042',
    emitidaEm: new Date(2026, 8, 24),
    validoAte: new Date(2026, 9, 24),
    clienteNome: 'Tecelagem Exemplo Ltda',
    cnpj: '16774052000155',
    endereco: {
      logradouro: 'Rua das Flores',
      numero: '100',
      complemento: null,
      bairro: 'Centro',
      cidade: 'Brusque',
      uf: 'sc',
    },
    linhas: [quadro(1), quadro(2, 'MB-04_D.S.', 874), quadro(3, 'MB-04_E.P.', 700)],
    customUnitario: 1500,
    customQuantidade: 1,
    servicosTotal: 9000,
    prazoEntregaDias: 10,
    prazoInstalacaoDias: 15,
    prazoVerificacaoDias: 5,
    prazoSoftwareDias: 20,
    ...extra,
  };
}

function montar(extra: Partial<DocumentoContratoEntrada> = {}): DadosDocumentoContrato {
  const r = dadosDoDocumento(entrada(extra));
  if (!r.ok) throw new Error(`faltou: ${r.faltando.join('; ')}`);
  return r.dados;
}

/** Texto corrido do .docx gerado, com `|` entre células e `\n` entre linhas. */
function texto(docx: Buffer): string {
  const xml = new PizZip(docx).file('word/document.xml')!.asText();
  return (
    xml
      .replace(/<\/w:tc>/g, ' | ')
      .replace(/<\/w:tr>|<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      // Célula termina em parágrafo: junta "01⏎ | Painel 1" em "01 | Painel 1".
      .replace(/\n \| /g, ' | ')
  );
}

describe('dadosDoDocumento — o que vai no papel', () => {
  it('prazo sai com numeral E extenso numa variável só', () => {
    const d = montar();
    expect(d.prazo_entrega).toBe('10 (dez)');
    expect(d.prazo_verificacao).toBe('5 (cinco)');
  });

  it('item 06: uma linha por quadro, IoT = S quando tem Data Sense ou End Point', () => {
    const d = montar();
    expect(d.quadros.map((q) => [q.item, q.tag, q.modelo, q.iot])).toEqual([
      ['01', 'Painel 1', 'MB-04', 'N'],
      ['02', 'Painel 2', 'MB-04', 'S'],
      ['03', 'Painel 3', 'MB-04', 'S'],
    ]);
    expect(d.quadros[0].corrente).toBe('61');
  });

  it('7.1: quadros iguais viram UMA linha com a quantidade somada', () => {
    const d = montar({ linhas: [quadro(1), quadro(2), quadro(3), quadro(4, 'MB-04_D.S.', 874)] });
    expect(d.locacao).toEqual([
      { descricao: 'MB-04', unitario: '425,00', quantidade: '3', total: '1.275,00' },
      { descricao: 'MB-04 / Data Sense', unitario: '874,00', quantidade: '1', total: '874,00' },
    ]);
    expect(d.locacao_mensal_total).toBe('2.149,00');
  });

  it('7.1: preço com desconto não se mistura com o cheio — o unitário impresso bate com o total', () => {
    const d = montar({ linhas: [quadro(1, 'MB-04', 425), quadro(2, 'MB-04', 400)] });
    expect(d.locacao.map((l) => [l.unitario, l.quantidade, l.total])).toEqual([
      ['425,00', '1', '425,00'],
      ['400,00', '1', '400,00'],
    ]);
  });

  it('serviços em 2 parcelas iguais', () => {
    const d = montar({ servicosTotal: 9000.5 });
    expect(d.servicos_total).toBe('9.000,50');
    expect(d.servicos_parcela).toBe('4.500,25');
  });

  it('cabeçalho: CNPJ formatado, endereço numa linha, UF maiúscula, data por extenso', () => {
    const d = montar();
    expect(d.cliente_cnpj).toBe('16.774.052/0001-55');
    expect(d.cliente_endereco).toBe('Rua das Flores, n. 100, Centro, Brusque-SC');
    expect(d.data_emissao_extenso).toBe('24 de setembro de 2026');
    expect(d.validade).toBe('24/10/2026');
  });
});

describe('dadosDoDocumento — recusa em vez de sair pela metade', () => {
  it('lista TUDO que falta de uma vez', () => {
    const r = dadosDoDocumento(
      entrada({
        validoAte: null,
        servicosTotal: null,
        prazoVerificacaoDias: null,
        linhas: [{ ...quadro(1), correnteA: null, quadroPainel: ' ' }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltando).toEqual(
      expect.arrayContaining([
        'validade da proposta',
        'valor total de instalação, materiais e customização',
        'prazo de verificação de funcionamento',
        'quadro 01: tag do quadro, corrente',
      ]),
    );
  });

  it('sem levantamento não há documento', () => {
    const r = dadosDoDocumento(entrada({ linhas: [] }));
    expect(r.ok).toBe(false);
  });

  it('centavo ímpar não divide em 2 parcelas iguais — recusa em vez de arredondar', () => {
    const r = dadosDoDocumento(entrada({ servicosTotal: 9000.01 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltando.join()).toMatch(/2 parcelas iguais/);
  });

  it('customização maior que o total de serviços é recusada', () => {
    const r = dadosDoDocumento(entrada({ customUnitario: 5000, customQuantidade: 2 }));
    expect(r.ok).toBe(false);
  });
});

describe('renderizarDocumento — com o modelo REAL', () => {
  const modelo = carregarModelo();

  /**
   * O ERP cobra por `TERMOS_DO_CONTRATO`; o cliente assina o TEXTO. Se alguém
   * trocar um sem o outro, cobrança e PDF assinado passam a dizer coisas
   * diferentes — este teste é o que impede.
   */
  it('TERMOS_DO_CONTRATO batem com o que o texto do modelo diz', () => {
    const { prazoMeses, diaVencimento } = TERMOS_DO_CONTRATO;
    const t = texto(modelo);
    const dia = `${String(diaVencimento).padStart(2, '0')} (${porExtenso(diaVencimento)})`;
    expect(t).toContain(`vigência mínima de ${prazoMeses} (${porExtenso(prazoMeses)}) meses`);
    expect(t).toContain(`(vigência de ${prazoMeses} meses)`);
    expect(t).toContain(`iniciando-se no dia ${dia}`);
    expect(t).toContain(`vencendo-se todos os demais no dia ${dia}`);
    // O resumo do cliente (página de aceite e e-mail) também sai daqui.
    const { garantiaMeses, primeiroAluguelNoMes } = TERMOS_DO_CONTRATO;
    expect(t).toContain(
      `garantia de funcionamento de ${garantiaMeses} (${porExtenso(garantiaMeses)}) meses`,
    );
    expect(primeiroAluguelNoMes).toBe(2);
    expect(t).toContain('do segundo mês subsequente');
  });

  it('a tabela cresce: 40 quadros → 40 linhas no item 06, nada cortado', () => {
    const linhas = Array.from({ length: 40 }, (_, i) => quadro(i + 1));
    const t = texto(renderizarDocumento(modelo, montar({ linhas })));
    for (let i = 1; i <= 40; i++) expect(t).toContain(`Painel ${i} |`);
    expect(t).toContain(`40 | Painel 40 | 100A | 220V | MB-04 | N`);
  });

  it('não sobra variável, "undefined" nem espaço em branco do modelo', () => {
    const t = texto(renderizarDocumento(modelo, montar()));
    expect(t).not.toMatch(/\{\{|\}\}/);
    expect(t).not.toContain('undefined');
    expect(t).not.toContain('(__)');
    expect(t).not.toContain('__ (____)');
    expect(t).not.toContain('RAZÃO SOCIAL');
  });

  it('os valores caem nos lugares certos', () => {
    const t = texto(renderizarDocumento(modelo, montar()));
    expect(t).toContain('PROP-0042');
    expect(t).toContain('em até 10 (dez) dias');
    expect(t).toContain('em até 5 (cinco) dias, contados da data em que for comunicada');
    expect(t).toContain('valor total de R$ 9.000,00');
    expect(t).toContain('R$ 4.500,00 cada');
    expect(t).toContain('aluguel mensal no valor de R$ 1.999,00');
    expect(t).toContain('validade até 24/10/2026');
    // A razão social aparece em todos os lugares do texto (cabeçalho, 04, 05,
    // III.d, 08.II, 09 e assinatura).
    expect(t.split('Tecelagem Exemplo Ltda').length - 1).toBe(7);
  });

  /**
   * Cláusula de aceite da assinatura eletrônica (Léo, 25/09): fecha o § 2º do
   * art. 10 da MP 2.200-2 — as partes aceitam a assinatura eletrônica e o log da
   * plataforma como prova. Sem ela, a validade da assinatura fora da ICP-Brasil
   * depende de discussão; com ela, o próprio contrato a reconhece.
   */
  it('traz a cláusula de aceite da assinatura eletrônica (MP 2.200-2, art. 10, § 2º)', () => {
    const t = texto(renderizarDocumento(modelo, montar()));
    expect(t).toContain('10 - Assinatura Eletrônica');
    expect(t).toContain('nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001');
    expect(t).toContain('os registros da plataforma (trilha de auditoria)');
    // Aprovações virou 11 — e continua ANTES das assinaturas.
    expect(t.indexOf('10 - Assinatura Eletrônica')).toBeLessThan(t.indexOf('11 - Aprovações'));
    expect(t).not.toContain('10 - Aprovações');
  });

  it('o arquivo gerado é um .docx válido (XML bem formado)', () => {
    const out = renderizarDocumento(modelo, montar());
    const xml = new PizZip(out).file('word/document.xml')!.asText();
    expect(xml.startsWith('<?xml')).toBe(true);
    const erros: string[] = [];
    new DOMParser({
      onError: (nivel, msg) => {
        if (nivel !== 'warning') erros.push(msg);
      },
    }).parseFromString(xml, 'application/xml');
    expect(erros).toEqual([]);
  });

  it('campo que o modelo pede e os dados não têm ESTOURA — não sai vazio', () => {
    const dados: Partial<DadosDocumentoContrato> = { ...montar() };
    delete dados.prazo_software;
    expect(() => renderizarDocumento(modelo, dados as DadosDocumentoContrato)).toThrow(
      VariavelDesconhecidaNoModelo,
    );
    expect(() => renderizarDocumento(modelo, dados as DadosDocumentoContrato)).toThrow(
      /prazo_software/,
    );
  });
});

/**
 * ⚠️ ESTRUTURAL. O modelo é lido do disco em runtime; se a imagem não o levar,
 * nada acusa no build nem nos testes — só o primeiro contrato em produção cai.
 */
describe('o modelo vai junto na imagem', () => {
  const dockerfile = readFileSync(join(__dirname, '..', '..', '..', 'Dockerfile'), 'utf8');

  it('o builder copia assets/ e o runtime leva de lá', () => {
    expect(dockerfile).toMatch(/^COPY assets \.\/assets$/m);
    expect(dockerfile).toMatch(/^COPY --from=builder .*\/app\/assets \.\/assets$/m);
  });

  it('o caminho procurado é relativo à raiz do app — a mesma do WORKDIR', () => {
    expect(CAMINHO_MODELO).toBe(
      join(process.cwd(), 'assets', 'contratos', 'proposta-contrato-anexo-i.docx'),
    );
    expect(dockerfile).toMatch(/^WORKDIR \/app$/m);
  });
});

/**
 * O papel timbrado e o rodapé (24/09).
 *
 * O rodapé com endereço, telefones e e-mail era DESENHO dentro do timbrado
 * (EMF, letras em contorno) — trocar um dado exigia a arte original. Os traços
 * saíram do desenho e o rodapé virou texto no Word. E o e-mail público é o
 * `comercial@` (decisão do Léo, 07/09): o `somatec@` não é canal.
 */
describe('o timbrado e o rodapé', () => {
  const zip = new PizZip(carregarModelo());
  const parte = (nome: string) => zip.file(nome)?.asText() ?? '';

  it('o rodapé é TEXTO, com o e-mail comercial@', () => {
    const rodape = parte('word/footer1.xml');
    expect(rodape).toContain('comercial@somatecblocking.com.br');
    expect(rodape).not.toContain('somatec@');
    // Dados oficiais = `CONTACT` do site (somatec_web/src/lib/constants/site.ts).
    // O timbrado trazia o endereço e os telefones de Dracena, que não valem mais.
    expect(rodape).toContain('Av. Fagundes Filho, 141, Conjunto 72');
    expect(rodape).toContain('+55 11 91764-4757');
    expect(rodape).not.toMatch(/Dracena|XV de Novembro|98138|3823/);
    expect(parte('word/document.xml')).toMatch(/<w:footerReference w:type="default"/);
  });

  it('o timbrado não carrega o PDF da arte antiga embutido', () => {
    // O EMF original trazia o PDF do Illustrator num comentário, com o rodapé
    // velho dentro. Conversor que prefere o PDF aos traços imprimiria o
    // `somatec@` de volta, com o rodapé de texto por cima.
    const rels = parte('word/_rels/header1.xml.rels');
    const alvo = /Target="media\/([^"]+)"/.exec(rels)?.[1];
    expect(alvo).toBeTruthy();
    const emf = Buffer.from(zip.file(`word/media/${alvo}`)!.asUint8Array());
    expect(emf.includes(Buffer.from('%PDF'))).toBe(false);
  });

  it('nenhum campo sai em VERMELHO — era a marcação de "preencher aqui"', () => {
    expect(parte('word/document.xml')).not.toContain('FF0000');
  });

  it('o rodapé sobrevive ao preenchimento', () => {
    const out = new PizZip(renderizarDocumento(carregarModelo(), montar()));
    expect(out.file('word/footer1.xml')?.asText()).toContain('comercial@somatecblocking.com.br');
  });
});
