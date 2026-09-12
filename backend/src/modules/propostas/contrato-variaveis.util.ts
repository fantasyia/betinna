import type { Prisma } from '@prisma/client';

/**
 * O que o contrato precisa saber da proposta e do cliente.
 *
 * Modelo de 12/09 ("CONTRATO DE LOCAÇÃO DE BENS MÓVEIS E OUTRAS AVENÇAS"):
 * vigência (60 meses), dia de vencimento (05) e carência estão ESCRITOS no
 * texto — deixaram de ser variável. Os itens e preços moram nos Anexos I e II,
 * não no corpo do contrato, então as tabelas f/p/s do modelo antigo saíram.
 */
export interface PropostaParaContrato {
  valor: Prisma.Decimal | number;
  criadoEm: Date;
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
  /** Dias corridos. Vazio = a proposta não definiu; sai em branco no contrato. */
  prazoEntregaDias: number | null;
  prazoInstalacaoDias: number | null;
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

const dinheiro = (v: Prisma.Decimal | number): string =>
  `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const dataPorExtenso = (d: Date): string =>
  `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;

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
const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

/** 0–999 em palavras. */
function ateMil(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r < 20) {
    if (r) partes.push(UNIDADES[r]);
  } else {
    const d = Math.floor(r / 10);
    const u = r % 10;
    partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
  }
  return partes.join(' e ');
}

/**
 * Inteiro não negativo por extenso, em pt-BR, até os bilhões — o que cabe num
 * aluguel. O "de" de "um milhão DE reais" é tratado em `valorPorExtenso`.
 */
export function numeroPorExtenso(n: number): string {
  const v = Math.floor(Math.abs(n));
  if (v === 0) return 'zero';
  const grupos: Array<[number, string, string]> = [
    [1_000_000_000, 'bilhão', 'bilhões'],
    [1_000_000, 'milhão', 'milhões'],
    [1_000, 'mil', 'mil'],
  ];
  // Cada grupo com o seu valor: a ligação com o anterior é "e" quando o grupo
  // é "redondo" (< 100 ou centena exata) — "mil e quinhentos", "dois milhões e
  // quinhentos mil", "dois mil e vinte" — e só espaço quando não é: "dois mil
  // trezentos e um", "um milhão duzentos e trinta e quatro mil".
  const partes: Array<[number, string]> = [];
  let resto = v;
  for (const [base, sing, plur] of grupos) {
    const q = Math.floor(resto / base);
    if (!q) continue;
    resto %= base;
    if (base === 1_000) partes.push([q, q === 1 ? 'mil' : `${ateMil(q)} mil`]);
    else partes.push([q, `${ateMil(q)} ${q === 1 ? sing : plur}`]);
  }
  if (resto) partes.push([resto, ateMil(resto)]);
  return partes
    .map(([valor, texto], i) => {
      if (i === 0) return texto;
      const redondo = valor < 100 || valor % 100 === 0;
      return `${redondo ? ' e ' : ' '}${texto}`;
    })
    .join('');
}

/** 1566.5 → "mil quinhentos e sessenta e seis reais e cinquenta centavos". */
export function valorPorExtenso(v: Prisma.Decimal | number): string {
  const total = Math.round(Number(v) * 100);
  const reais = Math.floor(total / 100);
  const centavos = total % 100;
  const milhaoRedondo = reais >= 1_000_000 && reais % 1_000_000 === 0;
  const partes: string[] = [];
  if (reais) {
    partes.push(
      `${numeroPorExtenso(reais)}${milhaoRedondo ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`,
    );
  }
  if (centavos) {
    partes.push(`${numeroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  }
  return partes.length ? partes.join(' e ') : 'zero reais';
}

/** 16774052000155 → 16.774.052/0001-55. Fora do padrão de 14 dígitos, vai como veio. */
export function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/[^0-9]/g, '');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Traduz proposta + cliente pros campos do contrato.
 *
 * O contrato é um Modelo no ClickSign com `{{variáveis}}` — este mapa é o
 * contrato ENTRE os dois lados. Nome de variável aqui tem que bater com o do
 * documento, senão o campo sai vazio e ninguém percebe até alguém ler o PDF.
 *
 * **Campo sem dado vai como string vazia, não como `undefined`.** Variável que
 * não é enviada some do documento deixando o texto costurado errado; string
 * vazia deixa o espaço em branco, que é o comportamento certo.
 *
 * O que fica vazio hoje, e por quê: **prazo de entrega e de instalação** são
 * decisão comercial, e a proposta ainda não os carrega — o contrato sai com
 * "no prazo de  () dias" e quem assina vê a lacuna, em vez de um número que o
 * sistema inventou.
 */
export function variaveisDoContrato(p: PropostaParaContrato): Record<string, string> {
  const limpo = (s: string | null | undefined): string => (s ?? '').trim();
  const dias = (n: number | null): [string, string] =>
    n && n > 0 ? [String(n), numeroPorExtenso(n)] : ['', ''];
  const [entregaDias, entregaExt] = dias(p.prazoEntregaDias);
  const [instDias, instExt] = dias(p.prazoInstalacaoDias);
  const cidade = limpo(p.endereco.cidade);
  const uf = limpo(p.endereco.uf).toUpperCase();

  return {
    razao_social: p.clienteNome,
    cnpj: formatarCnpj(limpo(p.cnpj)),
    endereco_logradouro: limpo(p.endereco.logradouro),
    endereco_numero: limpo(p.endereco.numero),
    endereco_complemento: limpo(p.endereco.complemento),
    endereco_bairro: limpo(p.endereco.bairro),
    endereco_cidade: cidade,
    endereco_uf: uf,
    // Cláusula 13.8 — foro da comarca da sede da CONTRATANTE.
    comarca: cidade && uf ? `${cidade}-${uf}` : cidade,
    prazo_entrega_dias: entregaDias,
    prazo_entrega_extenso: entregaExt,
    prazo_instalacao_dias: instDias,
    prazo_instalacao_extenso: instExt,
    aluguel_mensal: dinheiro(p.valor),
    aluguel_mensal_extenso: valorPorExtenso(p.valor),
    data_extenso: dataPorExtenso(p.criadoEm),
  };
}
