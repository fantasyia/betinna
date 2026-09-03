import type { Prisma } from '@prisma/client';

/** Item da proposta já resolvido com o SKU do produto. */
export interface ItemParaContrato {
  sku: string;
  produtoNome: string;
  quantidade: number;
  precoUnitario: Prisma.Decimal | number;
  total: Prisma.Decimal | number;
}

export interface PropostaParaContrato {
  numero: string;
  valor: Prisma.Decimal | number;
  criadoEm: Date;
  validoAte: Date | null;
  clienteNome: string;
  itens: ItemParaContrato[];
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

const dataCurta = (d: Date): string =>
  d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export const dataPorExtenso = (d: Date): string =>
  `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;

/** Hardware IoT tem sufixo no SKU; o resto é filtro híbrido puro. */
const ehHardware = (sku: string): boolean => /_D\.S\.|_E\.P\./i.test(sku);

/**
 * Traduz a proposta pros campos do contrato.
 *
 * O contrato é um Modelo no ClickSign com `{{variáveis}}` — este mapa é o
 * contrato ENTRE os dois lados. Nome de variável aqui tem que bater com o do
 * documento, senão o campo sai vazio e ninguém percebe até alguém ler o PDF.
 *
 * **Campo sem dado vai como string vazia, não como `undefined`.** Variável que
 * não é enviada some do documento deixando o texto costurado errado; string
 * vazia deixa o espaço em branco, que é o comportamento certo pra linha de
 * tabela que a proposta não usou.
 *
 * O que fica vazio hoje, e por quê:
 * - **quadro/painel e tensão por item**: não existem no app;
 * - **bloco de serviços** (instalação, materiais, customização): idem;
 * - **prazos da Cláusula 7**: decisão comercial, ainda não definida.
 */
export function variaveisDoContrato(p: PropostaParaContrato): Record<string, string> {
  const v: Record<string, string> = {
    razao_social: p.clienteNome,
    numero_proposta: p.numero,
    data_extenso: dataPorExtenso(p.criadoEm),
    // Sem validade explícita, 15 dias é o padrão do envio — melhor que branco
    // num campo que diz "esta proposta tem validade até".
    validade: dataCurta(p.validoAte ?? new Date(p.criadoEm.getTime() + 15 * 86_400_000)),
    total_mensal: dinheiro(p.valor),
    aluguel_mensal: dinheiro(p.valor),
  };

  // Cláusula 5 — I) filtros híbridos (5 linhas) e II) hardwares (2 linhas).
  const filtros = p.itens.filter((i) => !ehHardware(i.sku));
  const hardwares = p.itens.filter((i) => ehHardware(i.sku));
  for (let i = 1; i <= 5; i++) {
    const it = filtros[i - 1];
    v[`f${i}_modelo`] = it?.sku ?? '';
    v[`f${i}_tag`] = '';
    v[`f${i}_tensao`] = '';
  }
  for (let i = 1; i <= 2; i++) {
    const it = hardwares[i - 1];
    v[`h${i}_tag`] = '';
    v[`h${i}_tensao`] = '';
    // O modelo já traz "Data Sense"/"End Point" escritos na linha; o SKU vai
    // pra tabela de preços abaixo.
    void it;
  }

  // Cláusula 6 — I) valor de locação mensal, uma linha por item da proposta.
  for (let i = 1; i <= 5; i++) {
    const it = p.itens[i - 1];
    v[`p${i}_item`] = it ? it.sku || it.produtoNome : '';
    v[`p${i}_unit`] = it ? dinheiro(it.precoUnitario) : '';
    v[`p${i}_qtd`] = it ? String(it.quantidade) : '';
    v[`p${i}_total`] = it ? dinheiro(it.total) : '';
  }

  // II) serviços e III) prazos — sem dado no app ainda.
  for (let i = 1; i <= 3; i++) {
    v[`s${i}_unit`] = '';
    v[`s${i}_qtd`] = '';
    v[`s${i}_total`] = '';
  }
  v.servicos_total = '';
  v.servicos_total_extenso = '';
  v.servicos_parcela = '';
  v.prazo_entrega = '';
  v.prazo_instalacao = '';
  v.prazo_software = '';

  return v;
}
