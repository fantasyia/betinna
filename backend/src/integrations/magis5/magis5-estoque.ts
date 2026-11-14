import type { SituacaoPedido } from '@modules/erp/reserva-marketplace';
import { canalValido } from './magis5-pedido-vitrine';

/**
 * Pedido do Magis5 (`structureType=complete`, guardado em `Magis5Pedido.dados`)
 * → situação de estoque e peças. PURO.
 *
 * Status de pedido que o código não conhece vira DESCONHECIDO: não reserva, não
 * baixa e aparece no log. Um "segue" silencioso seria uma resposta plausível
 * pra uma pergunta que ninguém fez (CLAUDE.md, motor de fluxo, 10/09).
 */

/** Statuses da referência da API (`GET /orders`) que significam "vendido, sem nota". */
const RESERVA = new Set([
  'approved',
  'awaiting_invoice',
  'awaiting_send',
  'awaiting_logistic',
  'ready_to_print',
  'awaiting_stock',
  'out_of_stock',
]);
/** Saiu da loja: nota já existe, mesmo que o pedido não a traga. */
const DESPACHADO = new Set(['sent', 'delivered', 'not_delivered']);
const SEM_PAGAMENTO = new Set(['awaiting_approval']);

/**
 * Status de nota que valem como emitida (lista interna do Magis5 usa "authorized").
 * Qualquer outro (pending, canceled, rejected… ou um novo) NÃO conta: a reserva
 * segue segurando, que é o lado seguro.
 */
const NOTA_EMITIDA = new Set(['sent', 'authorized', 'sent_waiting_receipt', 'issued', 'emitida']);

const minusc = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** Alguma nota do pedido está emitida? Status de nota desconhecido NÃO conta. */
export function notaEmitida(invoices: unknown): boolean {
  if (!Array.isArray(invoices)) return false;
  return invoices.some((n) => {
    if (!n || typeof n !== 'object') return false;
    const o = n as Record<string, unknown>;
    const st = minusc(o.status);
    if (st) return NOTA_EMITIDA.has(st);
    // Sem status: só a chave de acesso de 44 dígitos prova a nota.
    return typeof o.key === 'string' && /^\d{44}$/.test(o.key.trim());
  });
}

export function situacaoMagis5(dados: Record<string, unknown>): {
  situacao: SituacaoPedido;
  status: string;
  motivo?: string;
} {
  const status = minusc(dados.status);
  const shipping = (dados.shipping ?? {}) as Record<string, unknown>;
  // Full: o estoque está no armazém do marketplace, fora do saldo do app.
  if (dados.fulfilled === true || minusc(shipping.logistic_type) === 'fulfillment') {
    return { situacao: 'IGNORAR', status, motivo: 'Full' };
  }
  // Loja API = pedido da vitrine que o app mandou: já reservou pelo `EstoqueReserva`.
  if (canalValido(dados.channel)) return { situacao: 'IGNORAR', status, motivo: 'vitrine' };
  if (status.startsWith('cancel')) return { situacao: 'CANCELADO', status };
  if (notaEmitida(dados.invoices) || DESPACHADO.has(status)) {
    return { situacao: 'NF_EMITIDA', status };
  }
  if (SEM_PAGAMENTO.has(status)) return { situacao: 'AGUARDANDO_PAGAMENTO', status };
  if (RESERVA.has(status)) return { situacao: 'RESERVAR', status };
  return { situacao: 'DESCONHECIDO', status };
}

/** SKU × quantidade do pedido (linhas do mesmo SKU somam). */
export function itensMagis5(dados: Record<string, unknown>): {
  itens: Map<string, number>;
  invalidos: number;
} {
  const itens = new Map<string, number>();
  let invalidos = 0;
  const linhas = Array.isArray(dados.order_items) ? dados.order_items : [];
  for (const l of linhas) {
    const o = (l ?? {}) as Record<string, unknown>;
    const item = (o.item ?? {}) as Record<string, unknown>;
    const sku = typeof item.seller_custom_field === 'string' ? item.seller_custom_field.trim() : '';
    const q = typeof o.quantity === 'number' ? o.quantity : Number(o.quantity);
    if (!sku || !Number.isInteger(q) || q <= 0) {
      invalidos++;
      continue;
    }
    itens.set(sku, (itens.get(sku) ?? 0) + q);
  }
  return { itens, invalidos };
}

/** O que um SKU é no catálogo do app. */
export type AlvoSku =
  | { tipo: 'peca'; produtoId: string }
  | { tipo: 'kit'; componentes: Array<{ produtoId: string; quantidade: number }> }
  /** "Cores Aleatórias" ou composição incompleta: não reserva (avisa). */
  | { tipo: 'kitSemComposicao' };

/** Desdobra SKUs em peças. O que não tem par vai pras listas, nunca é chutado. */
export function desdobrar(
  itens: Map<string, number>,
  catalogo: Map<string, AlvoSku>,
): { pecas: Map<string, number>; semVinculo: string[]; kitsSemComposicao: string[] } {
  const pecas = new Map<string, number>();
  const semVinculo: string[] = [];
  const kitsSemComposicao: string[] = [];
  const somar = (id: string, q: number) => pecas.set(id, (pecas.get(id) ?? 0) + q);
  for (const [sku, q] of itens) {
    const alvo = catalogo.get(sku);
    if (!alvo) semVinculo.push(sku);
    else if (alvo.tipo === 'kitSemComposicao') kitsSemComposicao.push(sku);
    else if (alvo.tipo === 'peca') somar(alvo.produtoId, q);
    else for (const c of alvo.componentes) somar(c.produtoId, c.quantidade * q);
  }
  return { pecas, semVinculo, kitsSemComposicao };
}

/** Corpo do `PUT /callbacks/stocks` (no máximo 50 SKUs por chamada). */
export function corpoSaldos(
  saldos: Array<{ sku: string; quantidade: number }>,
  deposito: { id: string; title: string },
) {
  return {
    stocks: saldos.map((s) => ({
      sku: s.sku,
      totalStock: s.quantidade,
      warehouses: [
        {
          id: deposito.id,
          title: deposito.title,
          stock: s.quantidade,
          consider: true,
          stockVirtual: s.quantidade,
        },
      ],
    })),
  };
}
