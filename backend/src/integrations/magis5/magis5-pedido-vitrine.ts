/**
 * Monta o pedido da vitrine no formato do `POST /orders` do Magis5 (Fase 4, 03/11).
 * PURO. Provado em 04/11: sem `status` volta 400. O frete do cliente vai em
 * `shipping_mode` como `ME-<id do serviço>`: a aba Envio da loja mapeia cada um
 * pro serviço do Melhor Envio. Sem o mapa o Magis5 escolhe o mais barato.
 */

/** A nota exige o intermediador; a vitrine cobra pelo Asaas (Léo, 04/11). */
const ASAAS = {
  documento: '19540550000121',
  nome: 'ASAAS GESTAO FINANCEIRA INSTITUICAO DE PAGAMENTO S.A.',
};

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
    servico: { id: number };
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
    intermediary: {
      salesDocument: ASAAS.documento,
      salesName: ASAAS.nome,
      paymentDocument: ASAAS.documento,
      paymentName: ASAAS.nome,
    },
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
      shipping_mode: `ME-${p.entrega.servico.id}`,
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
