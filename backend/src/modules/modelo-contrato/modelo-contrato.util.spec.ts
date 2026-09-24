import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { carregarModelo } from '@modules/propostas/contrato-documento.util';
import { validarModelo } from './modelo-contrato.util';

/**
 * O modelo subido pela tela é recusado ANTES de virar opção quando estraga o
 * contrato. Cada teste abaixo é um jeito real de o Word (ou a mão) estragar.
 */

const REAL = carregarModelo();

/** O modelo real com o document.xml mexido. */
function alterado(troca: (xml: string) => string): Buffer {
  const zip = new PizZip(REAL);
  const xml = zip.file('word/document.xml')!.asText();
  zip.file('word/document.xml', troca(xml));
  return zip.generate({ type: 'nodebuffer' });
}

const problemas = (b: Buffer): string[] => {
  const r = validarModelo(b);
  return r.ok ? [] : r.problemas;
};

describe('validarModelo', () => {
  it('o modelo do repositório passa e devolve o exemplo preenchido', () => {
    const r = validarModelo(REAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const xml = new PizZip(r.exemplo).file('word/document.xml')!.asText();
    expect(xml).toContain('Q-EXEMPLO-40');
    expect(xml).not.toContain('{{');
  });

  it('marcação apagada → recusa dizendo QUAL', () => {
    const p = problemas(alterado((x) => x.replace('{{prazo_software}}', '10 (dez)')));
    expect(p).toContain('falta a marcação {{prazo_software}}');
  });

  it('marcação com erro de digitação → recusa (e aponta as duas pontas)', () => {
    const p = problemas(alterado((x) => x.replace('{{cliente_cnpj}}', '{{Cliente_cnpj}}')));
    expect(p).toContain('{{Cliente_cnpj}} não existe — erro de digitação?');
    expect(p).toContain('falta a marcação {{cliente_cnpj}}');
  });

  it('chave quebrada pelo Word → recusa em português, sem stack trace', () => {
    const p = problemas(alterado((x) => x.replace('{{prazo_entrega}}', '{{prazo_entrega}')));
    expect(p.length).toBeGreaterThan(0);
    expect(p.join(' ')).toMatch(/chave|marcação/);
    expect(p.join(' ')).not.toMatch(/at \w+ \(/);
  });

  it('campo desconhecido dentro da lista de quadros → recusa', () => {
    const p = problemas(alterado((x) => x.replace('{{tag}}', '{{tag}}{{fase}}')));
    expect(p).toContain('{{fase}} dentro da lista quadros não existe — erro de digitação?');
  });

  it('lista de quadros FORA de tabela → recusa (não viraria linhas do item 06)', () => {
    // Tira o laço da linha da tabela e põe num parágrafo solto no fim.
    const p = problemas(
      alterado((x) =>
        // Esvazia a linha original (laço + campos) e põe tudo num parágrafo solto.
        [
          '{{#quadros}}',
          '{{item}}',
          '{{tag}}',
          '{{corrente}}',
          '{{tensao}}',
          '{{modelo}}',
          '{{iot}}',
          '{{/quadros}}',
        ]
          .reduce((acc, m) => acc.replace(m, ''), x)
          .replace(
            '</w:body>',
            '<w:p><w:r><w:t>{{#quadros}}{{item}}{{tag}}{{corrente}}{{tensao}}{{modelo}}{{iot}}{{/quadros}}</w:t></w:r></w:p></w:body>',
          ),
      ),
    );
    expect(p.join(' ')).toMatch(/LINHA de tabela/);
  });

  it('arquivo que não é .docx → recusa com a instrução de salvar certo', () => {
    expect(problemas(Buffer.from('%PDF-1.7 não é word'))).toEqual([
      'não é um arquivo .docx (salve como "Documento do Word")',
    ]);
  });

  it('arquivo grande demais → recusa antes de abrir', () => {
    expect(problemas(Buffer.alloc(16 * 1024 * 1024))[0]).toMatch(/limite é 14 MB/);
  });
});
