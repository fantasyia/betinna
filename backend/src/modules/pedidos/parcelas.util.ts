/**
 * Parcelas de um pedido, pela condição gravada nele.
 *
 * É a MESMA regra pro pedido que sobe pro ERP (parcelas no Tiny → o Tiny gera
 * e estorna as contas a receber junto com a nota) e pro lançamento que o app
 * faz quando o Tiny não gera. Um lugar só, senão as duas pontas divergem.
 */
export const DIAS_POR_CONDICAO: Record<string, number[]> = {
  avista: [0],
  '30dias': [30],
  '30_60': [30, 60],
  '30_60_90': [30, 60, 90],
};

export interface Parcela {
  /** Dias após a emissão. */
  dias: number;
  valor: number;
}

/** Divide em centavos exatos; a diferença de arredondamento vai na última. */
export function dividirEmParcelas(total: number, condicao: string | null | undefined): Parcela[] {
  const dias = DIAS_POR_CONDICAO[(condicao ?? 'avista').trim()] ?? [0];
  const centavos = Math.round(total * 100);
  const n = dias.length;
  const base = Math.floor(centavos / n);
  const sobra = centavos - base * n;
  return dias.map((d, i) => ({ dias: d, valor: (base + (i === n - 1 ? sobra : 0)) / 100 }));
}

/** Enum de forma de pagamento/recebimento do Tiny (o mesmo das contas). */
export const FORMA_TINY: Record<string, number> = { PIX: 15, BOLETO: 5 };

/** Nome da forma no cadastro do tenant (Configurações → Formas de recebimento). */
export const NOME_FORMA: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto' };
