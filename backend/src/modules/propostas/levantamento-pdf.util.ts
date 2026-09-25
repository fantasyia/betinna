import PDFDocument from 'pdfkit';
import type { ResumoProposta } from './proposta-resumo.util';

/**
 * O PDF do "Levantamento técnico de projeto" — o documento que o cliente
 * aprova e que vai ANEXADO no envelope do contrato (Léo, 25/09: o app gera,
 * o rep não anexa mais nada).
 *
 * Mesmo conteúdo e ordem da página de aceite (`PropostaAceitePage`): quadros,
 * aluguel por mês, condições, serviços e prazos. Referência de layout: o
 * levantamento da PROP-0027 que o Léo aprovou.
 *
 * ⛔ Marca do TENANT: cores, logo e rodapé chegam por `MarcaLevantamento` —
 * nenhum nome de empresa ou cor escrito aqui.
 */
export interface MarcaLevantamento {
  nome: string;
  primaria: string;
  secundaria: string;
  acao: string;
  /** Logo pra fundo ESCURO (PNG/JPEG). Com ela o cabeçalho é escuro, como no e-mail. */
  logoNegativo: Buffer | null;
  /** Logo pra fundo CLARO — usada só quando não há a negativa. */
  logo: Buffer | null;
  rodape: string | null;
}

const MM = 72 / 25.4;
const MARGEM = 16 * MM;
const TINTA = '#0B1620';
const CINZA = '#636363';
const LINHA = '#D0D0D0';
const FUNDO = '#F5F5F5';
const ALTURA_RODAPE = 24 * MM;
const NBSP = String.fromCharCode(0xa0);

const brl = (v: number) =>
  `R$ ${v
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d),)/g, '.')}`;
const dias = (n: number | null) => (n == null ? '—' : `${n} dia${n === 1 ? '' : 's'}`);
const dois = (n: number) => String(n).padStart(2, '0');

/** Data "pura" (validade, 00:00 UTC) — sem fuso, senão sai o dia anterior. */
function dataPura(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : '—';
}
/** Instante real (criação) — no fuso de Brasília. */
function dataDoInstante(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Escurece um hex (0–1) — o cabeçalho escuro é a primária mais funda, como na página. */
export function escurecer(hex: string, quanto: number): string {
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return hex;
  const c = (i: number) =>
    Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - quanto))
      .toString(16)
      .padStart(2, '0');
  return `#${c(0)}${c(2)}${c(4)}`;
}

export function desenharLevantamento(
  r: ResumoProposta,
  marca: MarcaLevantamento,
  opcoes: { comprimir?: boolean } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
      compress: opcoes.comprimir ?? true,
      info: { Title: `Levantamento técnico de projeto · ${r.numero}`, Author: marca.nome },
    });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    try {
      const W = doc.page.width;
      const H = doc.page.height;
      const CW = W - 2 * MARGEM;
      const x0 = MARGEM;
      let y = 0;

      /** Página nova quando o bloco não cabe acima do rodapé. */
      const garantir = (altura: number) => {
        if (y + altura > H - ALTURA_RODAPE - 6 * MM) {
          doc.addPage({ size: 'A4', margin: 0 });
          y = 14 * MM;
        }
      };

      // ── Cabeçalho ─────────────────────────────────────────────────────
      const escuro = !!marca.logoNegativo;
      const altCab = 30 * MM;
      doc.rect(0, 0, W, altCab).fill(escuro ? escurecer(marca.primaria, 0.35) : '#FFFFFF');
      if (!escuro) doc.rect(0, altCab - 2, W, 2).fill(marca.primaria);
      const logo = marca.logoNegativo ?? marca.logo;
      let comLogo = false;
      if (logo) {
        try {
          doc.image(logo, x0, altCab - 7 * MM - 13 * MM, { fit: [55 * MM, 13 * MM] });
          comLogo = true;
        } catch {
          /* imagem inválida: cai no nome em texto */
        }
      }
      if (!comLogo) {
        doc
          .font('Helvetica-Bold')
          .fontSize(16)
          .fillColor(escuro ? '#FFFFFF' : marca.primaria)
          .text(marca.nome, x0, altCab - 7 * MM - 16, { width: CW / 2, lineBreak: false });
      }
      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(escuro ? '#9ED6F0' : marca.secundaria)
        .text('PROPOSTA DE LOCAÇÃO', x0, altCab - 7 * MM - 26, {
          width: CW,
          align: 'right',
          characterSpacing: 1,
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(15)
        .fillColor(escuro ? '#FFFFFF' : marca.primaria)
        .text(r.numero, x0, altCab - 7 * MM - 15, { width: CW, align: 'right' });
      y = altCab + 7 * MM;

      // ── Título ────────────────────────────────────────────────────────
      doc
        .font('Helvetica-Bold')
        .fontSize(20)
        .fillColor(marca.primaria)
        .text('Levantamento técnico de projeto', x0, y, { width: CW });
      y = doc.y + 1 * MM;
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(CINZA)
        .text(
          'Medição feita quadro a quadro. O modelo de cada quadro é definido pela corrente medida.',
          x0,
          y,
          { width: CW },
        );
      y = doc.y + 5 * MM;

      const eyebrow = (t: string) => {
        doc
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .fillColor(marca.primaria)
          .text(t.toUpperCase(), x0, y, { width: CW, characterSpacing: 1.2 });
        y = doc.y + 2.5 * MM;
      };

      // ── Cliente ───────────────────────────────────────────────────────
      garantir(40 * MM);
      eyebrow('Cliente');
      const col1 = (CW - 8 * MM) * (1.4 / 2.4);
      const col2 = CW - 8 * MM - col1;
      const campos: Array<[string, string]> = [
        ['Razão social', r.cliente.razaoSocial],
        ['CNPJ', r.cliente.cnpj ?? '—'],
        // O CEP não quebra no meio (espaço inseparável).
        ['Endereço', (r.cliente.endereco || '—').replace(/CEP (\d)/, `CEP${NBSP}$1`)],
        ['Quem assina pelo cliente', r.signatarioNome ?? '—'],
        ['Data do levantamento', dataDoInstante(r.criadaEm)],
        ['Proposta válida até', dataPura(r.validoAte)],
      ];
      const campo = (rot: string, val: string, x: number, w: number, yy: number) => {
        doc.font('Helvetica').fontSize(8).fillColor(CINZA).text(rot, x, yy, { width: w });
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor(TINTA)
          .text(val, x, doc.y + 1, { width: w });
        return doc.y;
      };
      for (let i = 0; i < campos.length; i += 2) {
        const [a, b] = [campos[i], campos[i + 1]];
        const fimA = campo(a[0], a[1], x0, col1, y);
        const fimB = b ? campo(b[0], b[1], x0 + col1 + 8 * MM, col2, y) : fimA;
        y = Math.max(fimA, fimB) + 2 * MM;
      }
      y += 3 * MM;

      // ── Tabela genérica ───────────────────────────────────────────────
      type Coluna = { titulo: string; peso: number; direita?: boolean };
      type Celula = { texto: string; negrito?: boolean; tag?: string };
      const tabela = (colunas: Coluna[], linhas: Celula[][]) => {
        const pad = 3 * MM;
        // Coluna de NÚMERO nunca quebra: a largura é MEDIDA — o maior entre o
        // título (caixa alta com espaçamento) e o maior valor. "TENSÃ/O" e
        // "CORRENT/E" saíam cortados com largura por proporção. O texto livre
        // (quadro, modelo) fica com o que sobra, e esse pode quebrar linha.
        const medida = colunas.map((c, i) => {
          if (!c.direita) return 0;
          doc.font('Helvetica-Bold').fontSize(7.5);
          const titulo = doc.widthOfString(c.titulo.toUpperCase(), { characterSpacing: 0.6 });
          const valores = linhas.map((l) => {
            doc.font(l[i].negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
            return doc.widthOfString(l[i].texto);
          });
          return Math.ceil(Math.max(titulo, ...valores) + 2 * pad + 2);
        });
        const livre = CW - medida.reduce((s, w) => s + w, 0);
        const somaLivre = colunas.reduce((s, c) => s + (c.direita ? 0 : c.peso), 0);
        const larg = colunas.map((c, i) => (c.direita ? medida[i] : (c.peso / somaLivre) * livre));
        const cabecalho = () => {
          const alt = 7 * MM;
          doc.rect(x0, y, CW, alt).fill(marca.primaria);
          let x = x0;
          colunas.forEach((c, i) => {
            doc
              .font('Helvetica-Bold')
              .fontSize(7.5)
              .fillColor('#FFFFFF')
              .text(c.titulo.toUpperCase(), x + pad, y + 2.3 * MM, {
                width: larg[i] - 2 * pad,
                align: c.direita ? 'right' : 'left',
                characterSpacing: 0.6,
                lineBreak: false,
              });
            x += larg[i];
          });
          y += alt;
        };
        garantir(7 * MM + 9 * MM);
        cabecalho();
        for (const linha of linhas) {
          // Etiqueta ("principal"): ao lado do nome quando cabe na MESMA linha;
          // senão desce pra linha de baixo. Ao lado de um nome que quebra, ela
          // era desenhada pela largura do texto inteiro e invadia a coluna vizinha.
          const etiquetas = linha.map((cel, i) => {
            if (!cel.tag) return null;
            const util = larg[i] - 2 * pad;
            doc.font(cel.negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
            const wTexto = doc.widthOfString(cel.texto);
            doc.font('Helvetica-Bold').fontSize(7.5);
            const wTag = doc.widthOfString(cel.tag) + 3 * MM;
            return { wTexto, wTag, aoLado: wTexto + 1.5 * MM + wTag <= util };
          });
          const alturas = linha.map((cel, i) => {
            doc.font(cel.negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
            const h = doc.heightOfString(cel.texto || ' ', { width: larg[i] - 2 * pad });
            const e = etiquetas[i];
            return e && !e.aoLado ? h + 5.5 * MM : h;
          });
          const alt = Math.max(...alturas) + 4 * MM;
          if (y + alt > H - ALTURA_RODAPE - 6 * MM) {
            garantir(alt + 7 * MM);
            cabecalho();
          }
          let x = x0;
          linha.forEach((cel, i) => {
            const c = colunas[i];
            doc
              .font(cel.negrito ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(10)
              .fillColor(TINTA)
              .text(cel.texto, x + pad, y + 2 * MM, {
                width: larg[i] - 2 * pad,
                align: c.direita ? 'right' : 'left',
              });
            const e = etiquetas[i];
            if (e && cel.tag) {
              const tx = e.aoLado ? x + pad + e.wTexto + 1.5 * MM : x + pad;
              const ty = e.aoLado ? y + 2 * MM : doc.y + 1 * MM;
              doc
                .roundedRect(tx, ty, e.wTag, 4.2 * MM, 1.5)
                .lineWidth(0.8)
                .strokeColor(marca.secundaria)
                .stroke();
              doc
                .font('Helvetica-Bold')
                .fontSize(7.5)
                .fillColor(escurecer(marca.secundaria, 0.25))
                .text(cel.tag, tx + 1.5 * MM, ty + 0.8 * MM, { lineBreak: false });
            }
            x += larg[i];
          });
          y += alt;
          doc
            .moveTo(x0, y)
            .lineTo(x0 + CW, y)
            .lineWidth(0.75)
            .strokeColor(LINHA)
            .stroke();
        }
      };

      const nota = (t: string) => {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(CINZA)
          .text(t, x0, y + 2.5 * MM, { width: CW });
        y = doc.y;
      };

      // ── Quadros medidos ───────────────────────────────────────────────
      garantir(30 * MM);
      eyebrow('Quadros medidos');
      tabela(
        [
          { titulo: 'Quadro / painel', peso: 22 },
          { titulo: 'Tensão', peso: 10, direita: true },
          { titulo: 'Corrente', peso: 12, direita: true },
          { titulo: 'Modelo', peso: 35 },
          { titulo: 'Aluguel mensal', peso: 21, direita: true },
        ],
        r.quadros.map((q) => [
          { texto: q.quadro, tag: q.principal ? 'principal' : undefined },
          { texto: q.tensaoV != null ? `${q.tensaoV} V` : '—' },
          { texto: q.correnteA != null ? `${q.correnteA} A` : '—' },
          { texto: q.modelo },
          { texto: brl(q.aluguelMensal) },
        ]),
      );
      if (r.quadros.some((q) => q.principal)) {
        nota(
          'Com acompanhamento, o quadro principal recebe o concentrador de dados e os demais se comunicam com ele.',
        );
      }
      // Total do aluguel
      garantir(16 * MM);
      y += 3 * MM;
      const altTotal = 12 * MM;
      doc.rect(x0, y, CW, altTotal).fill(FUNDO);
      doc.rect(x0, y, 2 * MM, altTotal).fill(marca.acao);
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(marca.primaria)
        .text('Aluguel mensal total', x0 + 7 * MM, y + altTotal / 2 - 5, { lineBreak: false });
      doc.font('Helvetica').fontSize(9);
      const wMes = doc.widthOfString(' / mês');
      doc
        .fillColor(CINZA)
        .text(' / mês', x0 + CW - 5 * MM - wMes, y + altTotal / 2 - 1, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(18);
      const valorTotal = brl(r.aluguelMensalTotal);
      const wValor = doc.widthOfString(valorTotal);
      doc
        .fillColor(TINTA)
        .text(valorTotal, x0 + CW - 5 * MM - wMes - wValor - 1, y + altTotal / 2 - 8, {
          lineBreak: false,
        });
      y += altTotal + 5 * MM;

      // ── Cartões (condições / prazos) ──────────────────────────────────
      const cartoes = (itens: Array<[string, string]>) => {
        garantir(18 * MM);
        const gap = 3 * MM;
        const w = (CW - gap * 3) / 4;
        let fim = y;
        itens.forEach(([v, rot], i) => {
          const x = x0 + i * (w + gap);
          doc
            .moveTo(x, y)
            .lineTo(x + w, y)
            .lineWidth(2)
            .strokeColor(marca.secundaria)
            .stroke();
          doc
            .font('Helvetica-Bold')
            .fontSize(12)
            .fillColor(marca.primaria)
            .text(v, x, y + 2.5 * MM, { width: w });
          doc
            .font('Helvetica')
            .fontSize(8.5)
            .fillColor(CINZA)
            .text(rot, x, doc.y + 1, { width: w });
          fim = Math.max(fim, doc.y);
        });
        y = fim + 5 * MM;
      };

      eyebrow('Condições da locação');
      cartoes([
        [`${r.condicoes.vigenciaMeses} meses`, 'vigência do contrato'],
        [`dia ${dois(r.condicoes.diaVencimento)}`, 'vencimento mensal'],
        [`${r.condicoes.primeiroAluguelNoMes}º mês`, '1º aluguel, após o término da instalação'],
        [`${r.condicoes.garantiaMeses} meses`, 'garantia, a partir do término da instalação'],
      ]);

      // ── Serviços ──────────────────────────────────────────────────────
      if (r.servicos.total != null) {
        garantir(30 * MM);
        eyebrow('Serviços de implantação · pagamento único, fora do aluguel');
        const linhas: Celula[][] = [];
        if (r.servicos.customizacao) {
          linhas.push([
            { texto: 'Customização do software' },
            { texto: String(r.servicos.customizacao.quantidade) },
            { texto: brl(r.servicos.customizacao.unitario) },
            { texto: brl(r.servicos.customizacao.total) },
          ]);
        }
        linhas.push([
          { texto: 'Instalação, materiais e customização (total)', negrito: true },
          { texto: '' },
          { texto: '' },
          { texto: brl(r.servicos.total), negrito: true },
        ]);
        tabela(
          [
            { titulo: 'Serviço', peso: 52 },
            { titulo: 'Qtd', peso: 10, direita: true },
            { titulo: 'Valor unitário', peso: 20, direita: true },
            { titulo: 'Total', peso: 18, direita: true },
          ],
          linhas,
        );
        if (r.servicos.valorParcela != null) {
          nota(`Pago em ${r.servicos.parcelas} parcelas de ${brl(r.servicos.valorParcela)}.`);
        }
        y += 5 * MM;
      }

      // ── Prazos ────────────────────────────────────────────────────────
      garantir(26 * MM);
      eyebrow('Prazos combinados');
      cartoes([
        [dias(r.prazos.entregaDias), 'entrega'],
        [dias(r.prazos.instalacaoDias), 'instalação'],
        [dias(r.prazos.verificacaoDias), 'verificação, depois do fim da obra'],
        [dias(r.prazos.softwareDias), 'software'],
      ]);

      // ── Rodapé em TODAS as páginas ────────────────────────────────────
      const faixa = doc.bufferedPageRange();
      for (let i = faixa.start; i < faixa.start + faixa.count; i++) {
        doc.switchToPage(i);
        const yr = H - ALTURA_RODAPE + 4 * MM;
        doc.rect(0, yr, W, 3).fill(marca.primaria);
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(CINZA)
          .text(marca.rodape ?? marca.nome, x0, yr + 5 * MM, {
            width: CW - 22 * MM,
            height: ALTURA_RODAPE - 9 * MM,
          });
        if (faixa.count > 1) {
          doc.text(`${i - faixa.start + 1}/${faixa.count}`, x0 + CW - 20 * MM, yr + 5 * MM, {
            width: 20 * MM,
            align: 'right',
            lineBreak: false,
          });
        }
      }
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
