import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { barras, modulosCode128, modulosEan13 } from './codigo-barras';
import type { EtiquetasDto } from './etiquetas.dto';
import { EstoqueService } from './estoque.service';

/** mm → pontos do PDF. */
const MM = 72 / 25.4;

/**
 * Formatos do rolo (Léo, 20/10). A página do PDF é UMA FILEIRA do rolo, no
 * tamanho exato — impressora térmica, sem margem nem escala.
 */
export const FORMATOS = {
  /** 40 × 80 mm, 1 coluna (etiqueta em pé). */
  '40x80': { largura: 40, altura: 80, colunas: 1 },
  /** 50 × 30 mm, 2 colunas lado a lado. */
  '50x30': { largura: 50, altura: 30, colunas: 2 },
} as const;
export type Formato = keyof typeof FORMATOS;

export interface PecaEtiqueta {
  produtoId: string;
  modelo: string;
  cor: string;
  linha: string;
  tamanho: string;
  sku: string | null;
  ean: string | null;
}

/**
 * Etiqueta de código de barras das peças (card do Léo, 20/10): EAN-13 (ou
 * Code 128 do SKU, sem EAN), SKU escrito, data da impressão e — cabendo —
 * produto, cor e tamanho. Só unitários; kit fica pra depois.
 */
@Injectable()
export class EtiquetasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: EstoqueService,
  ) {}

  /** Peças do catálogo (unitárias, ativas) — a lista pra escolher o que imprimir. */
  async pecas(user: AuthenticatedUser): Promise<PecaEtiqueta[]> {
    const empresaId = await this.erp.empresaLigada(user);
    return this.carregar(empresaId);
  }

  private async carregar(empresaId: string, produtoIds?: string[]): Promise<PecaEtiqueta[]> {
    const vs = await this.prisma.catalogoVariacao.findMany({
      where: { empresaId, ativo: true, ...(produtoIds ? { produtoId: { in: produtoIds } } : {}) },
      select: {
        produtoId: true,
        sku: true,
        ean: true,
        modelo: { select: { nome: true, ordem: true } },
        modeloCor: { select: { cor: { select: { nome: true } } } },
        modeloLinha: { select: { linha: { select: { nome: true } } } },
        modeloTamanho: { select: { tamanho: { select: { nome: true, ordem: true } } } },
      },
    });
    return vs
      .sort(
        (a, b) =>
          a.modelo.ordem - b.modelo.ordem ||
          a.modelo.nome.localeCompare(b.modelo.nome) ||
          a.modeloCor.cor.nome.localeCompare(b.modeloCor.cor.nome) ||
          a.modeloLinha.linha.nome.localeCompare(b.modeloLinha.linha.nome) ||
          a.modeloTamanho.tamanho.ordem - b.modeloTamanho.tamanho.ordem,
      )
      .map((v) => ({
        produtoId: v.produtoId,
        modelo: v.modelo.nome,
        cor: v.modeloCor.cor.nome,
        linha: v.modeloLinha.linha.nome,
        tamanho: v.modeloTamanho.tamanho.nome,
        sku: v.sku,
        ean: v.ean,
      }));
  }

  /** PDF das etiquetas pedidas (peça × quantidade), no formato escolhido. */
  async gerar(user: AuthenticatedUser, dto: EtiquetasDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const pecas = await this.carregar(
      empresaId,
      dto.itens.map((i) => i.produtoId),
    );
    const porId = new Map(pecas.map((p) => [p.produtoId, p]));
    const fila: PecaEtiqueta[] = [];
    for (const i of dto.itens) {
      const p = porId.get(i.produtoId);
      if (!p) throw new BusinessRuleException('Peça que não é desta empresa (ou inativa)');
      if (!p.ean && !p.sku) {
        throw new BusinessRuleException(
          `${p.modelo} ${p.cor} ${p.tamanho}: sem EAN nem SKU — gere os códigos antes de imprimir`,
        );
      }
      for (let k = 0; k < i.quantidade; k++) fila.push(p);
    }
    const data = (dto.data ? new Date(`${dto.data}T12:00:00`) : new Date()).toLocaleDateString(
      'pt-BR',
      { timeZone: 'America/Sao_Paulo' },
    );
    const base64 = (await desenharPdf(fila, dto.formato, data)).toString('base64');
    return {
      filename: `etiquetas-${dto.formato}-${fila.length}.pdf`,
      etiquetas: fila.length,
      base64,
    };
  }
}

/** Monta o PDF: uma página por FILEIRA do rolo. Exportado pro teste. */
export function desenharPdf(fila: PecaEtiqueta[], formato: Formato, data: string): Promise<Buffer> {
  const f = FORMATOS[formato];
  const larguraPagina = f.largura * f.colunas * MM;
  const alturaPagina = f.altura * MM;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [larguraPagina, alturaPagina],
      margin: 0,
      autoFirstPage: false,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (let i = 0; i < fila.length; i += f.colunas) {
      doc.addPage({ size: [larguraPagina, alturaPagina], margin: 0 });
      for (let c = 0; c < f.colunas && i + c < fila.length; c++) {
        etiqueta(doc, fila[i + c]!, formato, c * f.largura * MM, data);
      }
    }
    doc.end();
  });
}

/** Uma etiqueta na posição x (pontos). Tudo cabe dentro do retângulo dela. */
function etiqueta(
  doc: PDFKit.PDFDocument,
  p: PecaEtiqueta,
  formato: Formato,
  x0: number,
  data: string,
) {
  const f = FORMATOS[formato];
  const W = f.largura * MM;
  const H = f.altura * MM;
  const margem = 2 * MM;
  const util = W - 2 * margem;
  const nome = `${p.modelo}`;
  const variante = `${p.cor} · ${p.linha} · ${p.tamanho}`;
  const ehEan = !!p.ean;
  const modulos = ehEan ? modulosEan13(p.ean!) : modulosCode128(p.sku!);
  // Zona quieta: 11 módulos à esquerda/7 à direita (EAN) ou 10 (Code 128).
  const quietaE = ehEan ? 11 : 10;
  const quietaD = ehEan ? 7 : 10;
  const modulo = util / (modulos.length + quietaE + quietaD);

  doc.fillColor('#000000');
  let y: number;
  let alturaBarras: number;
  if (formato === '40x80') {
    // Em pé: nome e variante em cima, barras no meio, SKU e data embaixo.
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text(nome, x0 + margem, 3 * MM, {
      width: util,
      height: 20,
      align: 'center',
      ellipsis: true,
    });
    doc.font('Helvetica').fontSize(7);
    doc.text(variante, x0 + margem, 3 * MM + 22, {
      width: util,
      height: 18,
      align: 'center',
      ellipsis: true,
    });
    y = 22 * MM;
    alturaBarras = 30 * MM;
  } else {
    doc.font('Helvetica-Bold').fontSize(6);
    doc.text(nome, x0 + margem, 1.5 * MM, {
      width: util,
      height: 8,
      align: 'center',
      ellipsis: true,
      lineBreak: false,
    });
    doc.font('Helvetica').fontSize(5.5);
    doc.text(variante, x0 + margem, 1.5 * MM + 8, {
      width: util,
      height: 7,
      align: 'center',
      ellipsis: true,
      lineBreak: false,
    });
    y = 7.5 * MM;
    alturaBarras = 12 * MM;
  }
  const xb = x0 + margem + quietaE * modulo;
  for (const [ini, larg] of barras(modulos))
    doc.rect(xb + ini * modulo, y, larg * modulo, alturaBarras).fill('#000000');

  // Número legível embaixo das barras.
  const fonteNumero = formato === '40x80' ? 9 : 6.5;
  doc.font('Helvetica').fontSize(fonteNumero);
  doc.text(ehEan ? p.ean! : p.sku!, x0 + margem, y + alturaBarras + 1, {
    width: util,
    align: 'center',
    lineBreak: false,
  });

  // SKU (quando o código de barras é o EAN) e a data.
  const yRodape = H - (formato === '40x80' ? 12 * MM : 5 * MM);
  doc.font('Helvetica-Bold').fontSize(formato === '40x80' ? 7 : 5.5);
  if (ehEan && p.sku) {
    doc.text(`SKU ${p.sku}`, x0 + margem, yRodape, {
      width: util,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });
  }
  doc.font('Helvetica').fontSize(formato === '40x80' ? 7 : 5);
  doc.text(data, x0 + margem, yRodape + (formato === '40x80' ? 12 : 7), {
    width: util,
    align: 'center',
    lineBreak: false,
  });
}
