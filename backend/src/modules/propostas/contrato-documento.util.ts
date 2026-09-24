import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { dataPorExtenso, formatarCnpj } from './contrato-variaveis.util';
import { porExtenso } from './proposta-tecnica-variaveis.util';

/**
 * O DOCUMENTO ÚNICO — proposta técnica + comercial + condições (Anexo I, Grupo A).
 *
 * 🔴 **Aqui o app monta o documento inteiro**, em vez de mandar variáveis pra um
 * Modelo do ClickSign. O motivo é a tabela: o levantamento vai de 1 a 240
 * quadros (Leandro, 24/09), e variável do ClickSign é substituição de TEXTO —
 * não cria linha. O modelo tinha 5 linhas fixas; um levantamento de 8 quadros
 * não cabia. Aqui a linha do item 06 e a do 7.1 se REPETEM, uma por quadro.
 *
 * ⚠️ O preço disso: o texto do contrato mora no repo
 * (`assets/contratos/proposta-contrato-anexo-i.docx`), e mudar uma cláusula
 * passa a exigir deploy. No desenho antigo o Léo editava no painel da ClickSign.
 *
 * 📌 **Nunca sai documento pela metade.** Campo que falta RECUSA o envio com a
 * lista do que falta — em vez de um espaço em branco num documento que alguém
 * assina. E o renderizador estoura em variável desconhecida (`nullGetter`):
 * sem isso, um `{{nome}}` trocado no .docx sairia vazio em silêncio.
 */

export const CAMINHO_MODELO = join(
  process.cwd(),
  'assets',
  'contratos',
  'proposta-contrato-anexo-i.docx',
);

/** Uma linha do levantamento, como ela vem do item da proposta. */
export interface LinhaLevantamento {
  /** Tag do quadro como o cliente o chama: "QGBT", "Painel 3". */
  quadroPainel: string | null;
  tensaoV: number | null;
  correnteA: number | null;
  /** SKU do produto: `MB-04`, `MB-04_D.S.`, `MB-04_E.P.`. */
  sku: string | null;
  quantidade: number;
  /** Total da linha JÁ com desconto — é o que o cliente paga por mês. */
  total: number;
}

export interface DocumentoContratoEntrada {
  numero: string;
  emitidaEm: Date;
  validoAte: Date | null;
  clienteNome: string;
  cnpj: string | null;
  endereco: {
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
  };
  linhas: LinhaLevantamento[];
  /** 7.2 — customização do software. */
  customUnitario: number | null;
  customQuantidade: number | null;
  /** 7.2 / III.a — instalação + materiais + customização, valor único. */
  servicosTotal: number | null;
  /** Item 08, incisos III a VI, em dias. */
  prazoEntregaDias: number | null;
  prazoInstalacaoDias: number | null;
  prazoVerificacaoDias: number | null;
  prazoSoftwareDias: number | null;
}

/** O que o .docx recebe. Nome de campo = nome da `{{variável}}` no modelo. */
export interface DadosDocumentoContrato {
  proposta_numero: string;
  data_emissao_extenso: string;
  validade: string;
  cliente_razao_social: string;
  cliente_cnpj: string;
  cliente_endereco: string;
  quadros: Array<{
    item: string;
    tag: string;
    corrente: string;
    tensao: string;
    modelo: string;
    iot: 'S' | 'N';
  }>;
  locacao: Array<{ descricao: string; unitario: string; quantidade: string; total: string }>;
  locacao_mensal_total: string;
  custom_unitario: string;
  custom_quantidade: string;
  custom_total: string;
  servicos_total: string;
  servicos_parcela: string;
  prazo_entrega: string;
  prazo_instalacao: string;
  prazo_verificacao: string;
  prazo_software: string;
}

export type MontagemDocumento =
  | { ok: true; dados: DadosDocumentoContrato }
  | { ok: false; faltando: string[] };

/** 1234.5 → "1.234,50". O "R$" já está escrito no modelo. */
const moeda = (v: number): string =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const centavos = (v: number): number => Math.round(v * 100);

/** `dd/mm/aaaa`. */
function dataCurta(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * "10 (dez)" — numeral e extenso numa variável SÓ.
 *
 * O documento escreve `__ (____) dias`: dois buracos. Duas variáveis poderiam
 * sair dessincronizadas (`15 (dez)`) num documento que alguém assina.
 */
const prazo = (dias: number): string => `${dias} (${porExtenso(dias)})`;

function enderecoEmLinha(e: DocumentoContratoEntrada['endereco']): string {
  const cidadeUf = [e.cidade?.trim(), e.uf?.trim().toUpperCase()].filter(Boolean).join('-');
  return [
    e.logradouro?.trim(),
    e.numero?.trim() ? `n. ${e.numero.trim()}` : null,
    e.complemento?.trim(),
    e.bairro?.trim(),
    cidadeUf || null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** `MB-04_D.S.` → modelo `MB-04`, acompanhamento `Data Sense`. */
function lerSku(sku: string | null): { modelo: string; acompanhamento: string | null } {
  const s = (sku ?? '').trim();
  const modelo = s.split('_')[0];
  if (s.endsWith('_D.S.')) return { modelo, acompanhamento: 'Data Sense' };
  if (s.endsWith('_E.P.')) return { modelo, acompanhamento: 'End Point' };
  return { modelo, acompanhamento: null };
}

/**
 * Proposta → dados do documento, ou a LISTA do que falta.
 *
 * Devolve tudo que falta de uma vez, não o primeiro: quem vai preencher quer
 * ver a lista inteira, não descobrir um campo por tentativa.
 */
export function dadosDoDocumento(p: DocumentoContratoEntrada): MontagemDocumento {
  const faltando: string[] = [];

  if (!p.validoAte) faltando.push('validade da proposta');
  if (!p.cnpj?.trim()) faltando.push('CNPJ do cliente');
  if (!enderecoEmLinha(p.endereco)) faltando.push('endereço do cliente');
  if (p.linhas.length === 0) faltando.push('itens do levantamento');

  p.linhas.forEach((l, i) => {
    const n = String(i + 1).padStart(2, '0');
    const falta = [
      !l.quadroPainel?.trim() && 'tag do quadro',
      l.correnteA == null && 'corrente',
      l.tensaoV == null && 'tensão',
      !lerSku(l.sku).modelo && 'modelo',
    ].filter(Boolean);
    if (falta.length) faltando.push(`quadro ${n}: ${falta.join(', ')}`);
  });

  const custom =
    p.customUnitario != null && p.customQuantidade != null
      ? p.customUnitario * p.customQuantidade
      : null;
  if (custom == null) faltando.push('valor e quantidade da customização (7.2)');
  if (p.servicosTotal == null) faltando.push('valor total de instalação, materiais e customização');

  // III.a diz "2 parcelas … no valor de R$ X cada". Total com centavo ímpar não
  // divide em duas iguais — e arredondar faria o documento prometer um total
  // que as parcelas não somam.
  if (p.servicosTotal != null && centavos(p.servicosTotal) % 2 !== 0) {
    faltando.push(
      `valor de serviços (${moeda(p.servicosTotal)}) não divide em 2 parcelas iguais — ajuste os centavos`,
    );
  }
  if (p.servicosTotal != null && custom != null && centavos(custom) > centavos(p.servicosTotal)) {
    faltando.push('a customização sozinha passa do valor total de serviços');
  }

  const prazos = [
    ['prazo de entrega', p.prazoEntregaDias],
    ['prazo de instalação', p.prazoInstalacaoDias],
    ['prazo de verificação de funcionamento', p.prazoVerificacaoDias],
    ['prazo de habilitação do software', p.prazoSoftwareDias],
  ] as const;
  for (const [nome, v] of prazos) if (v == null) faltando.push(nome);

  if (faltando.length) return { ok: false, faltando };

  // 7.1 — agrupa por descrição + preço efetivo. Dez quadros com MB-04 viram UMA
  // linha "MB-04 · 10", não dez linhas iguais. Preço efetivo (total ÷ qtd) em
  // vez do unitário de tabela: com desconto, unitário × qtd não bateria com o
  // total impresso ao lado.
  const grupos = new Map<string, { descricao: string; unit: number; qtd: number; total: number }>();
  for (const l of p.linhas) {
    const { modelo, acompanhamento } = lerSku(l.sku);
    const descricao = acompanhamento ? `${modelo} / ${acompanhamento}` : modelo;
    const unit = centavos(l.total / l.quantidade) / 100;
    const chave = `${descricao}|${unit}`;
    const g = grupos.get(chave) ?? { descricao, unit, qtd: 0, total: 0 };
    g.qtd += l.quantidade;
    g.total += l.total;
    grupos.set(chave, g);
  }
  const locacaoTotal = p.linhas.reduce((s, l) => s + l.total, 0);
  const servicos = p.servicosTotal!;

  return {
    ok: true,
    dados: {
      proposta_numero: p.numero,
      data_emissao_extenso: dataPorExtenso(p.emitidaEm),
      validade: dataCurta(p.validoAte!),
      cliente_razao_social: p.clienteNome,
      cliente_cnpj: formatarCnpj(p.cnpj!.trim()),
      cliente_endereco: enderecoEmLinha(p.endereco),
      quadros: p.linhas.map((l, i) => {
        const { modelo, acompanhamento } = lerSku(l.sku);
        return {
          item: String(i + 1).padStart(2, '0'),
          tag: l.quadroPainel!.trim(),
          corrente: String(l.correnteA),
          tensao: String(l.tensaoV),
          modelo,
          iot: acompanhamento ? 'S' : 'N',
        };
      }),
      locacao: [...grupos.values()].map((g) => ({
        descricao: g.descricao,
        unitario: moeda(g.unit),
        quantidade: String(g.qtd),
        total: moeda(g.total),
      })),
      locacao_mensal_total: moeda(locacaoTotal),
      custom_unitario: moeda(p.customUnitario!),
      custom_quantidade: String(p.customQuantidade),
      custom_total: moeda(custom!),
      servicos_total: moeda(servicos),
      servicos_parcela: moeda(centavos(servicos) / 2 / 100),
      prazo_entrega: prazo(p.prazoEntregaDias!),
      prazo_instalacao: prazo(p.prazoInstalacaoDias!),
      prazo_verificacao: prazo(p.prazoVerificacaoDias!),
      prazo_software: prazo(p.prazoSoftwareDias!),
    },
  };
}

export class VariavelDesconhecidaNoModelo extends Error {}

/**
 * Preenche o .docx. A linha que abre `{{#quadros}}` e fecha `{{/quadros}}` na
 * mesma linha de tabela é REPETIDA — uma por quadro.
 *
 * ⛔ `nullGetter` estoura: o default do docxtemplater imprime "undefined", e o
 * `''` que seria a alternativa tiraria a palavra do documento sem ninguém ver.
 */
export function renderizarDocumento(modelo: Buffer, dados: DadosDocumentoContrato): Buffer {
  const doc = new Docxtemplater(new PizZip(modelo), {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: (parte) => {
      throw new VariavelDesconhecidaNoModelo(
        `O modelo pede {{${parte.value}}} e os dados não têm esse campo.`,
      );
    },
  });
  doc.render(dados);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Lido do disco a cada envio: um contrato por vez não justifica cache. */
export function carregarModelo(caminho = CAMINHO_MODELO): Buffer {
  return readFileSync(caminho);
}
