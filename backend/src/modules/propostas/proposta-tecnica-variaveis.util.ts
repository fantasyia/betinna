import type { Prisma } from '@prisma/client';
import { dataPorExtenso } from './contrato-variaveis.util';

/**
 * As variáveis do ANEXO II — "Proposta Técnica para implementação do Sistema
 * Master Block IoT".
 *
 * 📌 Cravadas do documento que o Léo mandou em 18/09. Ele avisou que o próximo
 * só ACRESCENTA ao que este já tem, então o que está aqui não muda de nome — no
 * máximo ganha companhia.
 *
 * ⚠️ Complementa, não substitui, o `contrato-variaveis.util`: o Léo decidiu que
 * proposta comercial e contrato de locação vão no MESMO documento, então o
 * modelo do ClickSign recebe os dois conjuntos de variáveis juntos.
 *
 * 🔴 AS TABELAS SÃO O PONTO DIFÍCIL. O documento tem duas — supressores (3.1) e
 * hardwares (3.2) — e um modelo .docx com `{{variaveis}}` não faz linha
 * dinâmica: ele tem um número FIXO de linhas. Por isso cada linha vira um trio
 * de variáveis numeradas (`sup_01_quadro`, `sup_01_tensao`, `sup_01_modelo`) e
 * as sobrando saem vazias, que no documento é uma linha em branco.
 *
 * O teto é limitação do MODELO, não do app: para caber mais quadros, acrescenta-se
 * linhas no .docx e sobe-se o `MAX_LINHAS`. Um levantamento que estoure o teto é
 * recusado alto em vez de sair com quadro faltando — proposta técnica com um
 * quadro a menos é um quadro que fica sem proteção e ninguém percebe.
 */

/** Linhas por tabela no modelo. Trocar aqui exige trocar o .docx junto. */
export const MAX_LINHAS = 15;

/** Em qual das duas tabelas do Anexo II a linha entra. */
export type SecaoTecnica = 'SUPRESSOR' | 'HARDWARE';

export interface LinhaTecnica {
  /** Tag do quadro como o cliente o chama: "QGBT", "Painel 3". */
  quadroPainel: string | null;
  /** Tensão medida, em volts. */
  tensaoV: number | null;
  /** O que vai na coluna MODELO: "MB-04", "Data Sense", "End Point". */
  modelo: string;
  secao: SecaoTecnica;
}

export interface PropostaTecnica {
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
  /** Os prazos do item 04. Sem eles o documento sai com lacuna. */
  prazoEntregaDias: number | null;
  prazoInstalacaoDias: number | null;
  prazoSoftwareDias: number | null;
  linhas: LinhaTecnica[];
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const UNIDADES = [
  '',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const DEZENAS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];

/**
 * Número por extenso para os prazos — o documento escreve "__ (____) dias".
 *
 * Cobre 0–99, que é o alcance de um prazo em dias; acima disso devolve o
 * próprio número em vez de inventar, porque prazo de três dígitos num contrato
 * é sinal de erro de digitação, não de negócio.
 */
export function porExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 0) return String(n);
  if (n === 100) return 'cem';
  // "cento e vinte" — prazo de contrato chega a 120 meses.
  if (n > 100 && n < 200) return `cento e ${porExtenso(n - 100)}`;
  if (n > 99) return String(n);
  if (n < 20) return UNIDADES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? DEZENAS[d] : `${DEZENAS[d]} e ${UNIDADES[u]}`;
}

/** `dd/mm/aaaa` — o formato de "Validade da proposta" no documento. */
function dataCurta(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function cnpjFormatado(bruto: string | null): string {
  const so = (bruto ?? '').replace(/\D/g, '');
  if (so.length !== 14) return bruto ?? '';
  return `${so.slice(0, 2)}.${so.slice(2, 5)}.${so.slice(5, 8)}/${so.slice(8, 12)}-${so.slice(12)}`;
}

/** "Rua X, n. 100, sala 2, Centro, São Paulo-SP" — linha única do cabeçalho. */
function enderecoEmLinha(e: PropostaTecnica['endereco']): string {
  const cidadeUf = [e.cidade, e.uf].filter(Boolean).join('-');
  return [
    e.logradouro,
    e.numero ? `n. ${e.numero}` : null,
    e.complemento,
    e.bairro,
    cidadeUf || null,
  ]
    .filter(Boolean)
    .join(', ');
}

export class PropostaTecnicaIncompleta extends Error {}

/**
 * O mapa que vai pro modelo do ClickSign.
 *
 * ⛔ ESTOURA em vez de truncar quando há mais quadros que linhas no modelo.
 * Truncar sairia com um documento plausível e um quadro a menos — e o quadro
 * que sumisse ficaria sem supressor, sem ninguém notar até queimar.
 */
export function variaveisDaPropostaTecnica(p: PropostaTecnica): Record<string, string> {
  const supressores = p.linhas.filter((l) => l.secao === 'SUPRESSOR');
  const hardwares = p.linhas.filter((l) => l.secao === 'HARDWARE');

  for (const [nome, lista] of [
    ['supressores', supressores],
    ['hardwares', hardwares],
  ] as const) {
    if (lista.length > MAX_LINHAS) {
      throw new PropostaTecnicaIncompleta(
        `A proposta tem ${lista.length} ${nome} e o modelo comporta ${MAX_LINHAS} linhas. ` +
          'Acrescente linhas no modelo do ClickSign e suba o MAX_LINHAS junto — ' +
          'cortar aqui deixaria um quadro fora do documento.',
      );
    }
  }

  const vars: Record<string, string> = {
    // ── cabeçalho ──
    //
    // 📌 PT e PC recebem o MESMO número: o Léo decidiu (18/09) que é um
    // documento só — proposta comercial e contrato juntos. Os dois campos
    // continuam existindo no papel porque o documento os tem, e apagá-los
    // mudaria o texto que o jurídico aprovou.
    proposta_numero: p.numero,
    proposta_pt: p.numero,
    proposta_pc: p.numero,
    data_emissao_extenso: dataPorExtenso(p.emitidaEm),
    data_emissao_mes: MESES[p.emitidaEm.getMonth()],
    validade: p.validoAte ? dataCurta(p.validoAte) : '',
    razao_social: p.clienteNome,
    cnpj: cnpjFormatado(p.cnpj),
    endereco_completo: enderecoEmLinha(p.endereco),

    // ── item 04: prazos ──
    prazo_entrega: p.prazoEntregaDias != null ? String(p.prazoEntregaDias) : '',
    prazo_entrega_extenso: p.prazoEntregaDias != null ? porExtenso(p.prazoEntregaDias) : '',
    prazo_instalacao: p.prazoInstalacaoDias != null ? String(p.prazoInstalacaoDias) : '',
    prazo_instalacao_extenso:
      p.prazoInstalacaoDias != null ? porExtenso(p.prazoInstalacaoDias) : '',
    prazo_software: p.prazoSoftwareDias != null ? String(p.prazoSoftwareDias) : '',
    prazo_software_extenso: p.prazoSoftwareDias != null ? porExtenso(p.prazoSoftwareDias) : '',
  };

  // ── tabelas 3.1 e 3.2 ──
  //
  // As linhas não usadas saem VAZIAS e não omitidas: variável ausente no modelo
  // do ClickSign é impressa como `{{sup_09_quadro}}` no documento final.
  const preencher = (prefixo: string, linhas: LinhaTecnica[]) => {
    for (let i = 0; i < MAX_LINHAS; i++) {
      const n = String(i + 1).padStart(2, '0');
      const l = linhas[i];
      vars[`${prefixo}_${n}_item`] = l ? n : '';
      vars[`${prefixo}_${n}_quadro`] = l?.quadroPainel ?? '';
      vars[`${prefixo}_${n}_tensao`] = l?.tensaoV != null ? `${l.tensaoV}V` : '';
      vars[`${prefixo}_${n}_modelo`] = l?.modelo ?? '';
    }
  };
  preencher('sup', supressores);
  preencher('hw', hardwares);

  return vars;
}

/**
 * Do item da proposta para as linhas do documento.
 *
 * 🔴 UM item pode virar DUAS linhas. No catálogo, o acompanhamento é uma
 * variante do produto (`MB-04_D.S.` custa R$ 874 contra R$ 425 do MB-04 puro —
 * a diferença É o hardware). No documento, ele aparece separado: o supressor na
 * tabela 3.1 e o Data Sense na 3.2, cada um com o seu quadro e tensão.
 *
 * Desdobrar aqui mantém UMA verdade sobre preço (o item) e outra sobre
 * apresentação (as linhas), em vez de cadastrar o hardware como produto à parte
 * e ter que manter os dois em sincronia.
 */
export function linhasDoItem(item: {
  sku: string | null;
  quadroPainel: string | null;
  tensaoV: number | null;
}): LinhaTecnica[] {
  const sku = item.sku ?? '';
  const base = sku.split('_')[0];
  const comum = { quadroPainel: item.quadroPainel, tensaoV: item.tensaoV };

  const linhas: LinhaTecnica[] = [{ ...comum, modelo: base, secao: 'SUPRESSOR' }];
  if (sku.endsWith('_D.S.')) linhas.push({ ...comum, modelo: 'Data Sense', secao: 'HARDWARE' });
  if (sku.endsWith('_E.P.')) linhas.push({ ...comum, modelo: 'End Point', secao: 'HARDWARE' });
  return linhas;
}

/** Só pra deixar o tipo do Decimal disponível a quem importar este módulo. */
export type ValorProposta = Prisma.Decimal | number;
