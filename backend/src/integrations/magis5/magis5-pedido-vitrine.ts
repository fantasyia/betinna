/**
 * Monta o pedido da vitrine no formato do `POST /orders` do Magis5 (Fase 4, 03/11).
 * PURO. A documentação lista os campos sem dizer quais são exigidos: este corpo
 * só se prova no primeiro pedido de teste.
 */

export interface PedidoVitrine {
  numero: string;
  criadoEm: Date;
  total: number;
  frete: number;
  cliente: { nome: string; cnpj: string | null; email: string | null; telefone: string | null };
  itens: Array<{ sku: string; nome: string; quantidade: number; precoUnitario: number }>;
  entrega: {
    cep: string;
    endereco: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    uf: string;
  };
}

/** Só canal de loja API: o campo vem com "-" enquanto não há canal. */
export const canalValido = (canal: unknown): canal is string =>
  typeof canal === 'string' && canal.startsWith('api-');

export function montarPedidoMagis5(p: PedidoVitrine, canal: string) {
  const nomes = p.cliente.nome.trim().split(/\s+/);
  return {
    id: p.numero,
    dateCreated: p.criadoEm.toISOString(),
    channel: canal,
    buyer: {
      first_name: nomes[0],
      last_name: nomes.slice(1).join(' '),
      full_name: p.cliente.nome.trim(),
      email: p.cliente.email ?? undefined,
      billing_info: { doc_number: p.cliente.cnpj?.replace(/\D/g, '') },
      phone: { number: p.cliente.telefone?.replace(/\D/g, '') },
    },
    order_items: p.itens.map((i) => ({
      quantity: i.quantidade,
      unit_price: i.precoUnitario,
      currency_id: 'BRL',
      unitMeasurement: 'UN',
      item: { id: i.sku, seller_custom_field: i.sku, title: i.nome },
    })),
    payments: [{ status: 'approved', total_paid_amount: p.total, shipping_cost: p.frete }],
    shipping: {
      receiver_address: {
        street_name: p.entrega.endereco,
        street_number: p.entrega.numero,
        comment: p.entrega.complemento,
        zip_code: p.entrega.cep.replace(/\D/g, ''),
        neighborhood: { name: p.entrega.bairro },
        city: { name: p.entrega.cidade },
        state: { name: p.entrega.uf },
      },
    },
  };
}
