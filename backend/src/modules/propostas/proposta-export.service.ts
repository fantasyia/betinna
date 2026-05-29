import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

/**
 * Dados normalizados de uma proposta pra exportação (PDF/Excel).
 * Montado pelo PropostasService.dadosParaExport — desacopla o gerador
 * do schema Prisma.
 */
export interface PropostaExportData {
  numero: string;
  criadoEm: Date;
  validoAte: Date | null;
  status: string;
  formaPagamento: string;
  condicaoPagamento: string | null;
  subtotal: number;
  descontoGeral: number; // %
  valor: number; // total final
  observacoes: string | null;
  empresa: { nome: string; cnpj: string | null };
  cliente: { nome: string; cnpj: string | null; email: string | null };
  itens: Array<{
    produtoNome: string;
    quantidade: number;
    precoUnitario: number;
    desconto: number; // %
    total: number;
  }>;
}

const BRAND_NAVY = '#201554';
const BRAND_CYAN = '#2bcae5';

function fmtBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(d);
}

/**
 * Gera PDF e Excel de uma proposta comercial.
 *
 * - PDF via pdfkit (fonte Helvetica built-in — robusto em Docker, sem
 *   custom fonts que dão problema no bundle).
 * - Excel via exceljs (planilha com colunas formatadas).
 *
 * Ambos recebem `PropostaExportData` (já normalizado) e retornam Buffer.
 */
@Injectable()
export class PropostaExportService {
  async gerarPdf(data: PropostaExportData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 48 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const left = doc.page.margins.left;

        // ─── Cabeçalho ──────────────────────────────────────────────
        doc.fillColor(BRAND_NAVY).fontSize(22).font('Helvetica-Bold').text(data.empresa.nome, { continued: false });
        if (data.empresa.cnpj) {
          doc.fontSize(9).font('Helvetica').fillColor('#666').text(`CNPJ: ${data.empresa.cnpj}`);
        }
        doc.moveDown(0.5);
        doc
          .fillColor(BRAND_NAVY)
          .fontSize(15)
          .font('Helvetica-Bold')
          .text(`Proposta Comercial ${data.numero}`);
        doc
          .fontSize(9)
          .font('Helvetica')
          .fillColor('#666')
          .text(
            `Emitida em ${fmtDate(data.criadoEm)}` +
              (data.validoAte ? `  ·  Válida até ${fmtDate(data.validoAte)}` : ''),
          );

        // Linha divisória
        doc.moveDown(0.5);
        doc
          .strokeColor(BRAND_CYAN)
          .lineWidth(2)
          .moveTo(left, doc.y)
          .lineTo(left + pageWidth, doc.y)
          .stroke();
        doc.moveDown(0.8);

        // ─── Cliente ────────────────────────────────────────────────
        doc.fillColor(BRAND_NAVY).fontSize(11).font('Helvetica-Bold').text('Cliente');
        doc.fillColor('#222').fontSize(10).font('Helvetica').text(data.cliente.nome);
        if (data.cliente.cnpj) doc.fontSize(9).fillColor('#666').text(`CNPJ: ${data.cliente.cnpj}`);
        if (data.cliente.email) doc.fontSize(9).fillColor('#666').text(data.cliente.email);
        doc.moveDown(0.8);

        // ─── Tabela de itens ────────────────────────────────────────
        const cols = {
          produto: left,
          qtd: left + pageWidth * 0.5,
          preco: left + pageWidth * 0.62,
          desc: left + pageWidth * 0.78,
          total: left + pageWidth * 0.88,
        };
        // Header da tabela
        const headerY = doc.y;
        doc.rect(left, headerY - 2, pageWidth, 18).fill(BRAND_NAVY);
        doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold');
        doc.text('Produto', cols.produto + 4, headerY + 3, { width: pageWidth * 0.46 });
        doc.text('Qtd', cols.qtd, headerY + 3, { width: pageWidth * 0.1, align: 'right' });
        doc.text('Preço', cols.preco, headerY + 3, { width: pageWidth * 0.14, align: 'right' });
        doc.text('Desc%', cols.desc, headerY + 3, { width: pageWidth * 0.08, align: 'right' });
        doc.text('Total', cols.total, headerY + 3, { width: pageWidth * 0.12 - 4, align: 'right' });
        doc.y = headerY + 20;

        // Linhas
        doc.font('Helvetica').fontSize(9);
        for (const it of data.itens) {
          const rowY = doc.y;
          // Quebra de página se necessário
          if (rowY > doc.page.height - 120) {
            doc.addPage();
          }
          const y = doc.y;
          doc.fillColor('#222');
          doc.text(it.produtoNome, cols.produto + 4, y, { width: pageWidth * 0.46 });
          const lineH = doc.y - y; // altura ocupada pelo nome (pode quebrar)
          doc.text(String(it.quantidade), cols.qtd, y, { width: pageWidth * 0.1, align: 'right' });
          doc.text(fmtBRL(it.precoUnitario), cols.preco, y, {
            width: pageWidth * 0.14,
            align: 'right',
          });
          doc.text(it.desconto > 0 ? `${it.desconto}%` : '—', cols.desc, y, {
            width: pageWidth * 0.08,
            align: 'right',
          });
          doc.text(fmtBRL(it.total), cols.total, y, {
            width: pageWidth * 0.12 - 4,
            align: 'right',
          });
          doc.y = y + Math.max(lineH, 14) + 2;
          // separador leve
          doc
            .strokeColor('#eee')
            .lineWidth(0.5)
            .moveTo(left, doc.y - 1)
            .lineTo(left + pageWidth, doc.y - 1)
            .stroke();
        }

        doc.moveDown(0.8);

        // ─── Totais ─────────────────────────────────────────────────
        const totalBoxX = left + pageWidth * 0.55;
        const totalBoxW = pageWidth * 0.45;
        function linhaTotal(label: string, valor: string, bold = false) {
          const y = doc.y;
          doc
            .font(bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(bold ? 12 : 9)
            .fillColor(bold ? BRAND_NAVY : '#444');
          doc.text(label, totalBoxX, y, { width: totalBoxW * 0.55 });
          doc.text(valor, totalBoxX + totalBoxW * 0.55, y, {
            width: totalBoxW * 0.45 - 4,
            align: 'right',
          });
          doc.moveDown(0.3);
        }
        linhaTotal('Subtotal', fmtBRL(data.subtotal));
        if (data.descontoGeral > 0) {
          linhaTotal('Desconto geral', `${data.descontoGeral}%`);
        }
        doc.moveDown(0.2);
        linhaTotal('TOTAL', fmtBRL(data.valor), true);

        // ─── Condições + observações ────────────────────────────────
        doc.moveDown(1);
        doc.fillColor(BRAND_NAVY).fontSize(10).font('Helvetica-Bold').text('Condições');
        doc
          .fillColor('#444')
          .fontSize(9)
          .font('Helvetica')
          .text(
            `Forma de pagamento: ${data.formaPagamento}` +
              (data.condicaoPagamento ? `  ·  Condição: ${data.condicaoPagamento}` : ''),
          );
        if (data.observacoes) {
          doc.moveDown(0.5);
          doc.fillColor(BRAND_NAVY).fontSize(10).font('Helvetica-Bold').text('Observações');
          doc.fillColor('#444').fontSize(9).font('Helvetica').text(data.observacoes);
        }

        // ─── Rodapé ─────────────────────────────────────────────────
        doc.moveDown(2);
        doc
          .fontSize(8)
          .fillColor('#999')
          .font('Helvetica')
          .text(`Gerado por Betinna.ai · ${fmtDate(data.criadoEm)}`, left, doc.y, {
            width: pageWidth,
            align: 'center',
          });

        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async gerarExcel(data: PropostaExportData): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Betinna.ai';
    wb.created = data.criadoEm;
    const ws = wb.addWorksheet(`Proposta ${data.numero}`);

    // Cabeçalho
    ws.mergeCells('A1:E1');
    ws.getCell('A1').value = `${data.empresa.nome} — Proposta ${data.numero}`;
    ws.getCell('A1').font = { size: 14, bold: true, color: { argb: 'FF201554' } };
    ws.mergeCells('A2:E2');
    ws.getCell('A2').value =
      `Cliente: ${data.cliente.nome}` + (data.cliente.cnpj ? ` (${data.cliente.cnpj})` : '');
    ws.getCell('A2').font = { size: 10 };
    ws.mergeCells('A3:E3');
    ws.getCell('A3').value =
      `Emitida: ${fmtDate(data.criadoEm)}` +
      (data.validoAte ? ` · Válida até: ${fmtDate(data.validoAte)}` : '');
    ws.getCell('A3').font = { size: 9, color: { argb: 'FF666666' } };

    // Header da tabela (linha 5)
    const headerRow = ws.getRow(5);
    headerRow.values = ['Produto', 'Qtd', 'Preço unit.', 'Desc %', 'Total'];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF201554' } };
      cell.alignment = { vertical: 'middle' };
    });

    // Itens
    let r = 6;
    for (const it of data.itens) {
      const row = ws.getRow(r);
      row.values = [it.produtoNome, it.quantidade, it.precoUnitario, it.desconto, it.total];
      row.getCell(3).numFmt = 'R$ #,##0.00';
      row.getCell(5).numFmt = 'R$ #,##0.00';
      row.getCell(4).numFmt = '0"%"';
      r += 1;
    }

    // Totais
    r += 1;
    ws.getCell(`D${r}`).value = 'Subtotal';
    ws.getCell(`D${r}`).font = { bold: true };
    ws.getCell(`E${r}`).value = data.subtotal;
    ws.getCell(`E${r}`).numFmt = 'R$ #,##0.00';
    if (data.descontoGeral > 0) {
      r += 1;
      ws.getCell(`D${r}`).value = 'Desconto geral';
      ws.getCell(`E${r}`).value = data.descontoGeral / 100;
      ws.getCell(`E${r}`).numFmt = '0.0%';
    }
    r += 1;
    ws.getCell(`D${r}`).value = 'TOTAL';
    ws.getCell(`D${r}`).font = { bold: true, size: 12, color: { argb: 'FF201554' } };
    ws.getCell(`E${r}`).value = data.valor;
    ws.getCell(`E${r}`).numFmt = 'R$ #,##0.00';
    ws.getCell(`E${r}`).font = { bold: true, size: 12, color: { argb: 'FF201554' } };

    // Condições
    r += 2;
    ws.getCell(`A${r}`).value = `Pagamento: ${data.formaPagamento}${
      data.condicaoPagamento ? ` · ${data.condicaoPagamento}` : ''
    }`;
    if (data.observacoes) {
      r += 1;
      ws.getCell(`A${r}`).value = `Obs: ${data.observacoes}`;
    }

    // Larguras
    ws.getColumn(1).width = 45;
    ws.getColumn(2).width = 10;
    ws.getColumn(3).width = 15;
    ws.getColumn(4).width = 10;
    ws.getColumn(5).width = 15;

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer as ArrayBuffer);
  }
}
