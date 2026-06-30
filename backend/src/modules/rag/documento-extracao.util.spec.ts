import { describe, it, expect } from 'vitest';
import {
  dividirEmChunks,
  ehTextoPlano,
  extrairTexto,
  normalizarTexto,
} from './documento-extracao.util';

describe('documento-extracao.util', () => {
  describe('ehTextoPlano', () => {
    it('reconhece por mimetype', () => {
      expect(ehTextoPlano('text/plain', 'x.bin')).toBe(true);
      expect(ehTextoPlano('text/markdown', 'x')).toBe(true);
    });
    it('reconhece por extensão', () => {
      expect(ehTextoPlano('application/octet-stream', 'faq.txt')).toBe(true);
      expect(ehTextoPlano('application/octet-stream', 'notas.MD')).toBe(true);
      expect(ehTextoPlano('application/octet-stream', 'precos.csv')).toBe(true);
    });
    it('PDF/DOCX não são texto plano', () => {
      expect(ehTextoPlano('application/pdf', 'catalogo.pdf')).toBe(false);
      expect(
        ehTextoPlano(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'doc.docx',
        ),
      ).toBe(false);
    });
  });

  describe('extrairTexto (texto plano)', () => {
    it('decodifica buffer utf-8 direto', async () => {
      const t = await extrairTexto(Buffer.from('Olá ação preço', 'utf-8'), 'text/plain', 'a.txt');
      expect(t).toBe('Olá ação preço');
    });
  });

  describe('extrairTexto (PDF via officeparser)', () => {
    // PDF mínimo válido com xref correto, texto conhecido — trava o caminho AST→.toText().
    function pdfMinimo(texto: string): Buffer {
      const objs: Record<number, string> = {
        1: '<< /Type /Catalog /Pages 2 0 R >>',
        2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        3: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>',
        4: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      };
      const stream = `BT /F1 18 Tf 72 720 Td (${texto}) Tj ET`;
      objs[5] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      let pdf = '%PDF-1.4\n';
      const offsets: Record<number, number> = {};
      for (let i = 1; i <= 5; i++) {
        offsets[i] = Buffer.byteLength(pdf);
        pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
      }
      const xrefPos = Buffer.byteLength(pdf);
      pdf += 'xref\n0 6\n0000000000 65535 f \n';
      for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
      pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
      return Buffer.from(pdf, 'latin1');
    }

    it('extrai o texto de um PDF digital', async () => {
      const buf = pdfMinimo('Betinna conhecimento teste extracao');
      const t = await extrairTexto(buf, 'application/pdf', 'teste.pdf');
      expect(t).toContain('Betinna conhecimento teste extracao');
    });
  });

  describe('normalizarTexto', () => {
    it('colapsa espaços e preserva parágrafos', () => {
      expect(normalizarTexto('a   b\n\n\n\nc \t d')).toBe('a b\n\nc d');
    });
    it('normaliza CRLF', () => {
      expect(normalizarTexto('linha1\r\nlinha2')).toBe('linha1\nlinha2');
    });
  });

  describe('dividirEmChunks', () => {
    it('texto curto vira 1 chunk', () => {
      expect(dividirEmChunks('frase curta', 1800)).toEqual(['frase curta']);
    });

    it('texto vazio vira 0 chunks', () => {
      expect(dividirEmChunks('   \n\n  ', 1800)).toEqual([]);
    });

    it('quebra em fronteira de parágrafo, respeitando maxChars', () => {
      const p = (n: number) => `Paragrafo ${n} `.repeat(10).trim(); // ~140 chars
      const texto = [p(1), p(2), p(3), p(4)].join('\n\n');
      const chunks = dividirEmChunks(texto, 300);
      expect(chunks.length).toBeGreaterThan(1);
      // nenhum chunk estoura o limite
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(300);
      // junção preserva todo o conteúdo (sem perder parágrafo)
      expect(chunks.join(' ')).toContain('Paragrafo 1');
      expect(chunks.join(' ')).toContain('Paragrafo 4');
    });

    it('parágrafo gigante é fatiado por frase', () => {
      const frase = 'Esta e uma frase de teste. ';
      const gigante = frase.repeat(50).trim(); // ~1350 chars num parágrafo só
      const chunks = dividirEmChunks(gigante, 200);
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
    });

    it('palavra única gigante (sem pontuação) é fatiada bruto', () => {
      const gigante = 'x'.repeat(500);
      const chunks = dividirEmChunks(gigante, 100);
      expect(chunks.length).toBe(5);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    });
  });
});
