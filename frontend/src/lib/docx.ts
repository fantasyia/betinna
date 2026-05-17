/**
 * Export Word (.docx) — wrapper que faz dynamic import do `docx` lib.
 *
 * Caso de uso: gerar documentos formatados (relatório mensal, ficha cadastral
 * de cliente, contrato bilingual) que o usuário precisa abrir/editar no Word.
 * Pra dados puramente tabulares, prefira Excel.
 *
 * O .docx é gerado client-side e baixado direto — sem precisar do backend.
 */

import { fetchAllPages, type CsvColumn } from './csv';

export type DocxColumn<T> = CsvColumn<T>;

interface DocxSection {
  /** Título da seção (h1 ou h2) */
  titulo?: string;
  /** Subtítulo opcional (h3) */
  subtitulo?: string;
  /** Parágrafos de texto livre */
  paragrafos?: string[];
  /** Tabela com colunas + linhas (alternativa a parágrafos) */
  tabela?: { cabecalho: string[]; linhas: Array<Array<string | number | null>> };
}

/**
 * Gera doc Word a partir de seções estruturadas (título, parágrafos, tabela).
 * Útil pra relatórios e fichas.
 */
export async function gerarDocx(args: {
  filename: string;
  titulo: string;
  subtitulo?: string;
  secoes: DocxSection[];
}): Promise<void> {
  const docx = await import('docx');
  const {
    Document,
    Packer,
    Paragraph,
    HeadingLevel,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
  } = docx;

  const children: InstanceType<typeof Paragraph | typeof Table>[] = [];

  // Cabeçalho do documento
  children.push(
    new Paragraph({
      text: args.titulo,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.LEFT,
    }),
  );
  if (args.subtitulo) {
    children.push(
      new Paragraph({
        text: args.subtitulo,
        heading: HeadingLevel.HEADING_2,
      }),
    );
  }
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Gerado em ${new Date().toLocaleString('pt-BR')}`,
          italics: true,
          size: 18,
        }),
      ],
    }),
  );
  children.push(new Paragraph({ text: '' }));

  // Renderiza cada seção
  for (const sec of args.secoes) {
    if (sec.titulo) {
      children.push(
        new Paragraph({
          text: sec.titulo,
          heading: HeadingLevel.HEADING_2,
        }),
      );
    }
    if (sec.subtitulo) {
      children.push(
        new Paragraph({
          text: sec.subtitulo,
          heading: HeadingLevel.HEADING_3,
        }),
      );
    }
    if (sec.paragrafos) {
      for (const p of sec.paragrafos) {
        children.push(new Paragraph({ text: p }));
      }
    }
    if (sec.tabela) {
      const headerRow = new TableRow({
        tableHeader: true,
        children: sec.tabela.cabecalho.map(
          (h) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
              shading: { fill: 'EFEFF5' },
            }),
        ),
      });
      const dataRows = sec.tabela.linhas.map(
        (row) =>
          new TableRow({
            children: row.map(
              (cell) =>
                new TableCell({
                  children: [new Paragraph({ text: cell == null ? '' : String(cell) })],
                }),
            ),
          }),
      );
      children.push(
        new Table({
          rows: [headerRow, ...dataRows],
          width: { size: 100, type: WidthType.PERCENTAGE },
        }),
      );
    }
    children.push(new Paragraph({ text: '' }));
  }

  const doc = new Document({
    creator: 'Betinna.ai',
    title: args.titulo,
    sections: [{ properties: {}, children }],
  });

  const blob = await Packer.toBlob(doc);
  const filename = args.filename.endsWith('.docx') ? args.filename : `${args.filename}.docx`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Variante tabular — paginação + dados como uma única tabela no Word.
 * Conveniente pra exportar listas de pedidos/clientes/leads como docx.
 */
export async function exportToDocx<T>(args: {
  endpoint: string;
  query?: Record<string, string>;
  filename: string;
  titulo: string;
  columns: DocxColumn<T>[];
  maxPages?: number;
  pageSize?: number;
  onProgress?: (current: number, total: number) => void;
}): Promise<{ count: number }> {
  const all = await fetchAllPages<T>(args.endpoint, args.query ?? {}, {
    maxPages: args.maxPages,
    pageSize: args.pageSize,
    onProgress: args.onProgress,
  });

  const linhas: Array<Array<string | number | null>> = all.map((row) =>
    args.columns.map((c) => {
      const v = c.value(row);
      return v === undefined ? null : v;
    }),
  );

  await gerarDocx({
    filename: args.filename,
    titulo: args.titulo,
    subtitulo: `${all.length} registro${all.length === 1 ? '' : 's'}`,
    secoes: [
      {
        tabela: {
          cabecalho: args.columns.map((c) => c.header),
          linhas,
        },
      },
    ],
  });

  return { count: all.length };
}
