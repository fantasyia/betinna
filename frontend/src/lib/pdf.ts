/**
 * Export PDF — wrapper que faz dynamic import do `jspdf` + `jspdf-autotable`.
 *
 * Casos de uso:
 *  - Catálogo do REP — gerar PDF compartilhável com cliente (preços, fotos opcionais)
 *  - Relatório mensal de vendas — printable
 *  - Ficha cadastral de cliente — anexar a contrato
 *
 * O PDF é gerado client-side e baixado direto.
 */

import { fetchAllPages, type CsvColumn } from './csv';

export type PdfColumn<T> = CsvColumn<T>;

interface PdfSection {
  titulo?: string;
  subtitulo?: string;
  /** Parágrafos de texto livre */
  paragrafos?: string[];
  /** Tabela com colunas + linhas (renderizada via jspdf-autotable) */
  tabela?: { cabecalho: string[]; linhas: Array<Array<string | number | null>> };
}

interface GerarPdfArgs {
  filename: string;
  titulo: string;
  subtitulo?: string;
  secoes: PdfSection[];
  /**
   * Orientação da página. landscape pra tabelas largas (catálogo c/ muitas cols).
   */
  orientacao?: 'portrait' | 'landscape';
}

/**
 * Gera PDF estruturado (título + seções com parágrafos/tabelas) e dispara download.
 */
export async function gerarPdf(args: GerarPdfArgs): Promise<void> {
  const [{ default: JsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new JsPDF({
    orientation: args.orientacao ?? 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const margem = 40;
  let y = margem;

  // Cabeçalho do documento
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(args.titulo, margem, y);
  y += 24;

  if (args.subtitulo) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(args.subtitulo, margem, y);
    y += 18;
  }

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, margem, y);
  y += 18;
  doc.setTextColor(0);

  // Renderiza seções
  for (const sec of args.secoes) {
    if (sec.titulo) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(sec.titulo, margem, y);
      y += 18;
    }
    if (sec.subtitulo) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(80);
      doc.text(sec.subtitulo, margem, y);
      y += 14;
      doc.setTextColor(0);
    }
    if (sec.paragrafos) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      for (const p of sec.paragrafos) {
        const lines = doc.splitTextToSize(p, doc.internal.pageSize.width - margem * 2);
        doc.text(lines, margem, y);
        y += lines.length * 12 + 4;
      }
    }
    if (sec.tabela) {
      autoTable(doc, {
        startY: y,
        head: [sec.tabela.cabecalho],
        body: sec.tabela.linhas.map((row) => row.map((v) => (v == null ? '' : String(v)))),
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: margem, right: margem },
      });
      // autoTable atualiza `doc.lastAutoTable.finalY`
      type DocWithTable = typeof doc & { lastAutoTable?: { finalY: number } };
      const last = (doc as DocWithTable).lastAutoTable;
      y = (last?.finalY ?? y) + 12;
    }
    y += 8;
  }

  const filename = args.filename.endsWith('.pdf') ? args.filename : `${args.filename}.pdf`;
  doc.save(filename);
}

/**
 * Variante tabular — paginação + dados como tabela no PDF.
 */
export async function exportToPdf<T>(args: {
  endpoint: string;
  query?: Record<string, string>;
  filename: string;
  titulo: string;
  columns: PdfColumn<T>[];
  orientacao?: 'portrait' | 'landscape';
  maxPages?: number;
  pageSize?: number;
}): Promise<{ count: number }> {
  const all = await fetchAllPages<T>(args.endpoint, args.query ?? {}, {
    maxPages: args.maxPages,
    pageSize: args.pageSize,
  });

  await gerarPdf({
    filename: args.filename,
    titulo: args.titulo,
    subtitulo: `${all.length} registro${all.length === 1 ? '' : 's'}`,
    orientacao: args.orientacao ?? 'landscape',
    secoes: [
      {
        tabela: {
          cabecalho: args.columns.map((c) => c.header),
          linhas: all.map((row) =>
            args.columns.map((c) => {
              const v = c.value(row);
              return v === undefined ? null : v;
            }),
          ),
        },
      },
    ],
  });

  return { count: all.length };
}
