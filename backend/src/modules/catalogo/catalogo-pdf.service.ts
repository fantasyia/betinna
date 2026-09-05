import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { MarcaTenant } from '@modules/empresas/marca-tenant.service';

export interface LinhaCatalogoPdf {
  nome: string;
  /** SKU · marca · linha — o que couber numa linha só. */
  detalhe: string;
  /**
   * Descrição do produto (vem do ERP, `descricaoComplementar`). Até duas
   * linhas sob o nome; a linha cresce só quando existe. É o "pra que serve"
   * que o cliente lê no PDF — antes só saía o nome do modelo.
   */
  descricao?: string | null;
  /** URL da imagem do produto (do ERP). Best-effort: sem ela, entra o retângulo vazio. */
  imagem: string | null;
  /**
   * Os preços que ESTE material mostra — um ou dois.
   *
   * Array, não campo fixo: o rep leva só a locação, e a gestão escolhe entre
   * locação, venda ou AS DUAS na mesma tabela. Com dois campos fixos ("preco" e
   * "precoAlternativo") a coluna vazia teria que ser adivinhada aqui dentro.
   */
  precos: Array<{ rotulo: string; valor: number | null }>;
  /** "Sob encomenda · montagem em 1 dia útil" ou "12 un em estoque". */
  disponibilidade: string;
  /** Preço veio de acordo negociado com o cliente. */
  negociado: boolean;
}

export interface CatalogoPdfData {
  empresa: { nome: string; cnpj: string | null };
  /** Marca do TENANT — logo e cores. Ausente = identidade Betinna. */
  marca?: MarcaTenant;
  representante: { nome: string; email: string | null; telefone: string | null };
  cliente: { nome: string; cnpj: string | null } | null;
  geradoEm: Date;
  itens: LinhaCatalogoPdf[];
}

/** Identidade Betinna (BRANDBOOK.md) — reserva de quem não configurou a própria. */
const BRAND_NAVY = '#201554';
const BRAND_CYAN = '#2bcae5';
const CINZA = '#666666';
/** Altura do logo no cabeçalho: alto o bastante pra ler, baixo pra não roubar a página. */
const ALTURA_LOGO = 34;

const ALTURA_LINHA = 46;
/**
 * Descrição: fonte 7,5pt, no máximo 4 linhas. A altura da linha do produto
 * cresce só o que o texto precisar — 2 linhas fixas cortavam justamente o
 * "Inclui IoT Data Sense" das variantes, que é o que explica o produto.
 */
const FONTE_DESCRICAO = 7.5;
const MAX_LINHAS_DESCRICAO = 4;
const LADO_FOTO = 34;
/** Teto de imagens baixadas por PDF — catálogo grande não pode virar timeout. */
const MAX_IMAGENS = 60;
const TIMEOUT_IMAGEM_MS = 4000;

/** Descrição do ERP vem com quebras de linha; no PDF vira uma frase corrida. */
function compactar(texto: string): string {
  return texto
    .replace(/\r?\n+/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

/**
 * PDF do catálogo do representante — o material que ele manda pro cliente.
 *
 * Uma LINHA por produto, e cabe numa linha de propósito: foto pequena, nome,
 * o essencial (SKU · marca) em texto único, preço e disponibilidade. Catálogo
 * que ocupa meia página por item vira PDF de 30 páginas que ninguém abre no
 * celular.
 *
 * **As imagens são baixadas aqui, no servidor.** No navegador elas quebrariam:
 * o arquivo está no S3 do ERP e o canvas do jsPDF esbarra em CORS. Aqui é só
 * um fetch. Falha de imagem NÃO derruba o PDF — entra o espaço vazio e o
 * catálogo sai mesmo assim.
 *
 * O preço que entra é o que o CHAMADOR já resolveu (locação pro rep, negociado
 * do cliente quando houver). Este serviço não decide preço — decidir preço em
 * dois lugares é como o número errado chega no cliente.
 */
@Injectable()
export class CatalogoPdfService {
  private readonly logger = new Logger(CatalogoPdfService.name);

  async gerar(data: CatalogoPdfData): Promise<Buffer> {
    const imagens = await this.baixarImagens(data.itens);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const left = doc.page.margins.left;
        const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const direita = left + largura;

        this.cabecalho(doc, data, left, largura);

        // Os rótulos das colunas de preço saem do primeiro item: é o mesmo
        // conjunto pro catálogo inteiro (quem escolheu foi o usuário, uma vez).
        const rotulos = (data.itens[0]?.precos ?? []).map((x) => x.rotulo);
        let y = doc.y + 6;
        this.cabecalhoDaTabela(doc, left, largura, y, rotulos);
        y += 18;

        const larguraDescricao = largura - LADO_FOTO - 8;
        for (const item of data.itens) {
          const alturaDesc = this.alturaDaDescricao(doc, item.descricao, larguraDescricao);
          const altura = ALTURA_LINHA + alturaDesc;
          // Quebra de página ANTES de desenhar: linha cortada ao meio é o
          // defeito clássico de PDF montado por posição.
          if (y + altura > doc.page.height - doc.page.margins.bottom - 30) {
            doc.addPage();
            y = doc.page.margins.top;
            this.cabecalhoDaTabela(doc, left, largura, y, rotulos);
            y += 18;
          }
          this.linha(
            doc,
            item,
            imagens.get(item.imagem ?? ''),
            left,
            largura,
            y,
            data.marca,
            alturaDesc,
          );
          y += altura;
          doc
            .moveTo(left, y - 6)
            .lineTo(direita, y - 6)
            .strokeColor('#e5e5e5')
            .lineWidth(0.5)
            .stroke();
        }

        this.rodape(doc, data, left, largura);
        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private cabecalho(
    doc: PDFKit.PDFDocument,
    data: CatalogoPdfData,
    left: number,
    largura: number,
  ): void {
    const primaria = data.marca?.primaria ?? BRAND_NAVY;
    const secundaria = data.marca?.secundaria ?? BRAND_CYAN;

    // O logo é o que faz o material ser DA EMPRESA e não do sistema. Quando
    // ele existe, o nome em texto sai de cena — os dois juntos empilham a
    // mesma informação duas vezes.
    let alturaTopo = 0;
    if (data.marca?.logo) {
      try {
        doc.image(data.marca.logo, left, doc.y, { fit: [190, ALTURA_LOGO] });
        alturaTopo = ALTURA_LOGO;
      } catch {
        /* logo inválido: cai no nome em texto, como era antes */
      }
    }
    if (alturaTopo) {
      doc.y += alturaTopo + 6;
      if (data.empresa.cnpj) {
        doc.fontSize(8).font('Helvetica').fillColor(CINZA).text(`CNPJ: ${data.empresa.cnpj}`, left);
      }
    } else {
      doc.fillColor(primaria).fontSize(20).font('Helvetica-Bold').text(data.empresa.nome, left);
      if (data.empresa.cnpj) {
        doc.fontSize(8).font('Helvetica').fillColor(CINZA).text(`CNPJ: ${data.empresa.cnpj}`);
      }
    }

    doc.moveDown(0.4);
    doc.fillColor(primaria).fontSize(14).font('Helvetica-Bold').text('Catálogo de produtos', left);

    doc.moveDown(0.2);
    doc.fontSize(9).font('Helvetica').fillColor(CINZA);
    const contato = [data.representante.nome, data.representante.telefone, data.representante.email]
      .filter(Boolean)
      .join(' · ');
    doc.text(contato, left);
    if (data.cliente) {
      doc
        .fillColor(primaria)
        .font('Helvetica-Bold')
        .text(
          `Preparado para ${data.cliente.nome}${data.cliente.cnpj ? ` · ${data.cliente.cnpj}` : ''}`,
          left,
        );
    }
    doc.moveDown(0.4);
    doc
      .moveTo(left, doc.y)
      .lineTo(left + largura, doc.y)
      .strokeColor(secundaria)
      .lineWidth(2)
      .stroke();
  }

  private cabecalhoDaTabela(
    doc: PDFKit.PDFDocument,
    left: number,
    largura: number,
    y: number,
    rotulos: string[],
  ): void {
    const duas = rotulos.length > 1;
    const colPreco = left + largura - (duas ? 210 : 100);
    const colDisp = left + largura - (duas ? 320 : 230);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(CINZA);
    doc.text('PRODUTO', left, y);
    doc.text('DISPONIBILIDADE', colDisp, y, { width: 100 });
    rotulos.forEach((r, idx) => {
      doc.text(r.toUpperCase(), colPreco + idx * 110, y, { width: 100, align: 'right' });
    });
  }

  /** Altura que a descrição ocupa (0 sem texto; teto de MAX_LINHAS_DESCRICAO). */
  private alturaDaDescricao(
    doc: PDFKit.PDFDocument,
    descricao: string | null | undefined,
    largura: number,
  ): number {
    if (!descricao) return 0;
    doc.fontSize(FONTE_DESCRICAO).font('Helvetica');
    const linhaPt = doc.currentLineHeight(true);
    const necessario = doc.heightOfString(compactar(descricao), { width: largura });
    return Math.min(necessario, linhaPt * MAX_LINHAS_DESCRICAO) + 4;
  }

  private linha(
    doc: PDFKit.PDFDocument,
    item: LinhaCatalogoPdf,
    imagem: Buffer | undefined,
    left: number,
    largura: number,
    y: number,
    marca?: MarcaTenant,
    alturaDesc = 0,
  ): void {
    const primaria = marca?.primaria ?? BRAND_NAVY;
    const secundaria = marca?.secundaria ?? BRAND_CYAN;
    const duasColunas = item.precos.length > 1;
    const colPreco = left + largura - (duasColunas ? 210 : 100);
    const colDisp = left + largura - (duasColunas ? 320 : 230);
    const textoX = left + LADO_FOTO + 8;
    const larguraTexto = colDisp - textoX - 8;

    if (imagem) {
      try {
        doc.image(imagem, left, y, { fit: [LADO_FOTO, LADO_FOTO], align: 'center' });
      } catch {
        /* imagem inválida: segue sem ela — o catálogo importa mais que a foto */
      }
    } else {
      doc.rect(left, y, LADO_FOTO, LADO_FOTO).strokeColor('#e5e5e5').lineWidth(0.5).stroke();
    }

    doc.fillColor('#111111').fontSize(10).font('Helvetica-Bold');
    doc.text(item.nome, textoX, y + 3, { width: larguraTexto, ellipsis: true, lineBreak: false });
    doc.fillColor(CINZA).fontSize(8).font('Helvetica');
    doc.text(item.detalhe, textoX, y + 17, {
      width: larguraTexto,
      ellipsis: true,
      lineBreak: false,
    });

    // Descrição abaixo de tudo (nome, disponibilidade e preço ocupam até y+28),
    // então pode usar a largura inteira da linha. Duas linhas no máximo.
    if (item.descricao && alturaDesc > 0) {
      doc.fillColor('#444444').fontSize(FONTE_DESCRICAO).font('Helvetica');
      doc.text(compactar(item.descricao), textoX, y + 30, {
        width: left + largura - textoX,
        height: alturaDesc - 2,
        ellipsis: true,
      });
    }

    doc.fillColor(CINZA).fontSize(8).font('Helvetica');
    doc.text(item.disponibilidade, colDisp, y + 10, { width: 120, ellipsis: true });

    item.precos.forEach((preco, idx) => {
      const x = colPreco + idx * 110;
      doc
        .fontSize(7)
        .font('Helvetica')
        .fillColor(CINZA)
        .text(preco.rotulo, x, y + 2, { width: 100, align: 'right' });
      doc
        .fontSize(duasColunas ? 10.5 : 12)
        .font('Helvetica-Bold')
        .fillColor(preco.valor == null ? CINZA : primaria)
        .text(preco.valor == null ? 'sob consulta' : fmtBRL(preco.valor), x, y + 12, {
          width: 100,
          align: 'right',
        });
    });
    if (item.negociado) {
      doc
        .fontSize(6.5)
        .font('Helvetica')
        .fillColor(secundaria)
        .text('preço negociado', colPreco, y + 28, { width: 100, align: 'right' });
    }
  }

  private rodape(
    doc: PDFKit.PDFDocument,
    data: CatalogoPdfData,
    left: number,
    largura: number,
  ): void {
    const quando = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(data.geradoEm);
    doc.moveDown(1);
    doc
      .fontSize(7.5)
      .font('Helvetica')
      .fillColor(CINZA)
      .text(
        [
          `Gerado em ${quando}`,
          `${data.itens.length} produto(s)`,
          'preços sujeitos a confirmação',
          data.marca?.rodape,
        ]
          .filter(Boolean)
          .join(' · '),
        left,
        doc.y,
        { width: largura, align: 'center' },
      );
  }

  /**
   * Baixa as imagens dos produtos (best-effort, em paralelo).
   *
   * Sem timeout, um S3 lento seguraria o PDF inteiro; sem teto, um catálogo de
   * 300 itens viraria 300 downloads. Falhou, some a foto — nunca o catálogo.
   */
  private async baixarImagens(itens: LinhaCatalogoPdf[]): Promise<Map<string, Buffer>> {
    const urls = [...new Set(itens.map((i) => i.imagem).filter((u): u is string => !!u))].slice(
      0,
      MAX_IMAGENS,
    );
    const mapa = new Map<string, Buffer>();
    await Promise.all(
      urls.map(async (url) => {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), TIMEOUT_IMAGEM_MS);
          const r = await fetch(url, { signal: ctrl.signal });
          clearTimeout(timer);
          if (!r.ok) return;
          const tipo = r.headers.get('content-type') ?? '';
          // pdfkit só embute PNG e JPEG. Qualquer outra coisa (webp, svg) seria
          // exceção na hora de desenhar — melhor nem baixar.
          if (!/png|jpe?g/i.test(tipo)) return;
          mapa.set(url, Buffer.from(await r.arrayBuffer()));
        } catch {
          /* imagem é enfeite: o catálogo sai sem ela */
        }
      }),
    );
    if (urls.length > mapa.size) {
      this.logger.warn(
        `[catalogo-pdf] ${urls.length - mapa.size} de ${urls.length} imagem(ns) não vieram`,
      );
    }
    return mapa;
  }
}
