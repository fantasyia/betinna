import type { FiscalEmpresa, FiscalProduto } from '@modules/vitrine/fiscal';

/**
 * Exportação do catálogo pro cadastro no Magis5 (03/11, card cmvzt7jgx). Só
 * monta os dados: nada aqui escreve no Magis5. PURO.
 *
 * Herança: a peça herda do modelo, o fiscal vazio cai no padrão da empresa e o
 * kit herda das peças. NENHUM valor inventado: o que não existe sai null e entra
 * em `faltando`.
 */

/** Variação do catálogo, já com o que ela herda do modelo. */
export interface PecaBase {
  id: string;
  ativa: boolean;
  sku: string | null;
  skuSecundario: string | null;
  ean: string | null;
  semGtin: boolean;
  modelo: string;
  cor: string;
  linha: string;
  tamanho: string;
  composicao: string | null;
  descricao: string | null;
  preco: number | null;
  custo: number | null;
  ncm: string | null;
  fiscal: FiscalProduto | null;
  pesoGramas: number | null;
  fotos: string[];
}

export interface KitBase {
  sku: string;
  skuSecundario: string | null;
  nome: string;
  tamanho: string;
  aleatorio: boolean;
  composicaoOk: boolean;
  componentes: Array<{ variacaoId: string; quantidade: number }>;
}

interface Fiscal {
  ncm: string | null;
  cest: string | null;
  origem: string | null;
  unidade: string | null;
  marca: string | null;
  crt: string | null;
  csosn: string | null;
  cfopDentro: string | null;
  cfopFora: string | null;
  cfopForaNaoContribuinte: string | null;
  cstPisCofins: string | null;
  ibsCbsCst: string | null;
  ibsCbsClassTrib: string | null;
}

export interface Embalagem {
  comprimentoCm: number | null;
  larguraCm: number | null;
  alturaCm: number | null;
}

/** O Magis5 quer `origin` inteiro. */
const origemNumero = (o: string | null) => (o === null ? null : Number(o));

export interface PecaExportada extends Omit<Fiscal, 'origem'> {
  tipo: 'peca';
  origem: number | null;
  descricao: string | null;
  preco: number | null;
  custo: number | null;
  sku: string | null;
  skuSecundario: string | null;
  ean: string | null;
  semGtin: boolean;
  nome: string;
  modelo: string;
  cor: string;
  linha: string;
  tamanho: string;
  composicao: string | null;
  pesoGramas: number | null;
  embalagem: Embalagem;
  fotos: string[];
  faltando: string[];
}

export interface KitExportado extends Omit<Fiscal, 'origem'> {
  tipo: 'kit';
  origem: number | null;
  sku: string;
  skuSecundario: string | null;
  nome: string;
  tamanho: string;
  aleatorio: boolean;
  pesoGramas: number | null;
  embalagem: Embalagem | null;
  /** Só existe quando as peças fecham; a % de cada item ainda não foi definida. */
  composicao: Array<{ sku: string; quantidade: number }> | null;
  faltando: string[];
}

/**
 * Campos que o cadastro da nota precisa. CEST, IBS/CBS e CRT não entram: nem todo
 * item usa. Marca e EAN também não (Léo, 03/11): a peça sobe sem marca e sem EAN.
 */
const OBRIGATORIOS: Array<keyof Fiscal> = [
  'ncm',
  'origem',
  'unidade',
  'csosn',
  'cfopDentro',
  'cfopFora',
];

function fiscalDaPeca(p: PecaBase, empresa: FiscalEmpresa | null): Fiscal {
  const f = p.fiscal;
  return {
    ncm: p.ncm ?? null,
    cest: f?.cest ?? null,
    origem: f?.origem ?? null,
    unidade: f?.unidade ?? null,
    marca: f?.marca ?? null,
    crt: empresa?.crt ?? null,
    csosn: f?.csosn ?? empresa?.csosn ?? null,
    cfopDentro: f?.cfopDentro ?? empresa?.cfopDentro ?? null,
    cfopFora: f?.cfopFora ?? empresa?.cfopFora ?? null,
    cfopForaNaoContribuinte: empresa?.cfopForaNaoContribuinte ?? null,
    cstPisCofins: empresa?.cstPisCofins ?? null,
    ibsCbsCst: f?.ibsCbsCst ?? null,
    ibsCbsClassTrib: f?.ibsCbsClassTrib ?? null,
  };
}

const faltaFiscal = (f: Fiscal) => OBRIGATORIOS.filter((c) => !f[c]) as string[];

export function exportarPeca(
  p: PecaBase,
  empresa: FiscalEmpresa | null,
  /** Embalagem individual do frete: vale quando o produto não tem medida própria. */
  padrao: Embalagem | null = null,
): PecaExportada {
  const fiscal = fiscalDaPeca(p, empresa);
  const embalagem = {
    comprimentoCm: p.fiscal?.embalagemComprimentoCm ?? padrao?.comprimentoCm ?? null,
    larguraCm: p.fiscal?.embalagemLarguraCm ?? padrao?.larguraCm ?? null,
    alturaCm: p.fiscal?.embalagemAlturaCm ?? padrao?.alturaCm ?? null,
  };
  const faltando = [
    ...(p.sku ? [] : ['sku']),
    ...(p.pesoGramas ? [] : ['pesoGramas']),
    ...(Object.values(embalagem).some((v) => !v) ? ['embalagem'] : []),
    ...faltaFiscal(fiscal),
  ];
  return {
    tipo: 'peca',
    sku: p.sku,
    skuSecundario: p.skuSecundario,
    ean: p.ean,
    semGtin: p.semGtin,
    nome: `${p.modelo} ${p.cor} ${p.linha} ${p.tamanho}`,
    modelo: p.modelo,
    cor: p.cor,
    linha: p.linha,
    tamanho: p.tamanho,
    composicao: p.composicao,
    pesoGramas: p.pesoGramas,
    embalagem,
    fotos: p.fotos,
    ...fiscal,
    origem: origemNumero(fiscal.origem),
    descricao: p.descricao,
    preco: p.preco,
    custo: p.custo,
    faltando,
  };
}

/** Até aqui o kit vai na embalagem individual, só mais alta (Léo, 03/11). */
const MAX_PECAS_NA_INDIVIDUAL = 3;

/**
 * Kit herda das peças só o que TODAS têm igual; divergiu, sai null e entra em
 * `faltando` como `<campo> diverge entre as peças`. NCM e CEST são a exceção:
 * vale o da peça principal, a de maior valor no kit (Léo, 03/11).
 */
export function exportarKit(
  k: KitBase,
  pecas: Map<string, PecaBase>,
  empresa: FiscalEmpresa | null,
  padrao: Embalagem | null = null,
): KitExportado {
  const itens = k.componentes.flatMap((c) => {
    const peca = pecas.get(c.variacaoId);
    return peca ? [{ peca, quantidade: c.quantidade }] : [];
  });
  const fiscais = itens.map((i) => fiscalDaPeca(i.peca, empresa));
  const faltando: string[] = [];
  const fiscal = {} as Fiscal;
  const valorNoKit = (i: (typeof itens)[number]) => (i.peca.preco ?? 0) * i.quantidade;
  const principal = itens.length
    ? itens.reduce((maior, i) => (valorNoKit(i) > valorNoKit(maior) ? i : maior))
    : null;
  for (const campo of Object.keys(fiscalDaPeca(VAZIA, empresa)) as Array<keyof Fiscal>) {
    const valores = [...new Set(fiscais.map((f) => f[campo]))];
    if (valores.length > 1 && principal && (campo === 'ncm' || campo === 'cest')) {
      fiscal[campo] = fiscalDaPeca(principal.peca, empresa)[campo];
      continue;
    }
    fiscal[campo] = valores.length === 1 ? valores[0] : null;
    if (valores.length > 1) faltando.push(`${campo} diverge entre as peças`);
  }
  faltando.push(
    ...faltaFiscal(fiscal).filter((c) => !faltando.includes(`${c} diverge entre as peças`)),
  );

  const composicaoFechada =
    k.composicaoOk &&
    itens.length > 0 &&
    itens.length === k.componentes.length &&
    itens.every((i) => i.peca.sku && i.peca.ativa);
  if (!k.composicaoOk) faltando.push(k.aleatorio ? 'composicao (aleatório)' : 'composicao');
  else if (!composicaoFechada) faltando.push('composicao com peça sem SKU ou inativa');

  const semPeso = !itens.length || itens.some((i) => !i.peca.pesoGramas);
  if (semPeso) faltando.push('pesoGramas');

  // Altura = soma das peças; a medida própria do modelo (moletom = 5) vence a padrão.
  const totalPecas = itens.reduce((soma, i) => soma + i.quantidade, 0);
  const cabe = totalPecas > 0 && totalPecas <= MAX_PECAS_NA_INDIVIDUAL;
  const alturas = itens.map(
    (i) => (i.peca.fiscal?.embalagemAlturaCm ?? padrao?.alturaCm ?? 0) * i.quantidade,
  );
  const embalagem =
    cabe && padrao?.comprimentoCm && padrao.larguraCm && alturas.every(Boolean)
      ? { ...padrao, alturaCm: alturas.reduce((a, b) => a + b, 0) }
      : null;
  if (totalPecas > 0 && !embalagem) faltando.push('embalagem');

  return {
    tipo: 'kit',
    sku: k.sku,
    skuSecundario: k.skuSecundario,
    nome: k.nome,
    tamanho: k.tamanho,
    aleatorio: k.aleatorio,
    pesoGramas: semPeso
      ? null
      : itens.reduce((soma, i) => soma + (i.peca.pesoGramas ?? 0) * i.quantidade, 0),
    embalagem,
    composicao: composicaoFechada
      ? itens.map((i) => ({ sku: i.peca.sku as string, quantidade: i.quantidade }))
      : null,
    ...fiscal,
    origem: origemNumero(fiscal.origem),
    faltando,
  };
}

const VAZIA: PecaBase = {
  id: '',
  ativa: true,
  sku: null,
  skuSecundario: null,
  ean: null,
  semGtin: false,
  modelo: '',
  cor: '',
  linha: '',
  tamanho: '',
  composicao: null,
  descricao: null,
  preco: null,
  custo: null,
  ncm: null,
  fiscal: null,
  pesoGramas: null,
  fotos: [],
};

/** Quantos SKUs têm cada pendência, do mais comum pro menos. */
export function resumirFaltas(itens: Array<{ faltando: string[] }>) {
  const contagem = new Map<string, number>();
  for (const i of itens) {
    for (const f of i.faltando) contagem.set(f, (contagem.get(f) ?? 0) + 1);
  }
  return {
    total: itens.length,
    completos: itens.filter((i) => !i.faltando.length).length,
    faltas: [...contagem.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([campo, skus]) => ({ campo, skus })),
  };
}
