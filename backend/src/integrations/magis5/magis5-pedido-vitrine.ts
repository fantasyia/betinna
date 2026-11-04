/**
 * Monta o pedido da vitrine no formato do `POST /orders` do Magis5 (Fase 4, 03/11).
 * PURO. Provado em 04/11: sem `status` volta 400. O POST ignora a logística; ela
 * entra por PATCH depois (`corpoLogistica`).
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
    /** Serviço escolhido no checkout: o id do Melhor Envio. */
    servico: { id: number; nome?: string };
    volumes?: unknown[];
  };
}

/** Só canal de loja API: o campo vem com "-" enquanto não há canal. */
export const canalValido = (canal: unknown): canal is string =>
  typeof canal === 'string' && canal.startsWith('api-');

export function montarPedidoMagis5(p: PedidoVitrine, canal: string) {
  const nomes = p.cliente.nome.trim().split(/\s+/);
  const doc = p.cliente.cnpj?.replace(/\D/g, '');
  // Com CNPJ o Magis5 troca o first_name pela razão social e mantém o last_name:
  // mandar sobrenome repete o nome ("LGHB CONFECCOES LTDA Confeccoes Ltda", 04/11).
  const empresa = doc?.length === 14;
  return {
    id: p.numero,
    dateCreated: p.criadoEm.toISOString(),
    channel: canal,
    status: 'approved',
    quantityPackage: p.entrega.volumes?.length || 1,
    invoiceVolume: p.entrega.volumes?.length || 1,
    buyer: {
      first_name: empresa ? p.cliente.nome.trim() : nomes[0],
      last_name: empresa ? '' : nomes.slice(1).join(' '),
      full_name: p.cliente.nome.trim(),
      email: p.cliente.email ?? undefined,
      billing_info: { doc_number: doc },
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

/**
 * Tira o pedido de "Ag. logística". Provado em 04/11: o PATCH só pega depois de
 * uns 6 min do POST (antes responde "Api-null" sem erro), e o Magis5 cota sozinho
 * pelo Melhor Envio: mandamos SEDEX e ele escolheu Loggi. O serviço enviado só
 * destrava, não escolhe a transportadora.
 */
export const corpoLogistica = (servico: { id: number; nome?: string }) => ({
  shipping: {
    shipping_mode: servico.nome || 'Melhor Envio',
    logistic: { logisticId: String(servico.id) },
  },
});

export function logisticaResolvida(resposta: unknown): boolean {
  const modo = (resposta as { shipping?: { shipping_mode?: unknown } } | null)?.shipping
    ?.shipping_mode;
  return typeof modo === 'string' && modo.startsWith('Melhor Envio');
}
