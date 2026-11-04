import { describe, expect, it } from 'vitest';
import { canalValido, montarPedidoMagis5, type PedidoVitrine } from './magis5-pedido-vitrine';

const PEDIDO: PedidoVitrine = {
  numero: 'PED-1',
  criadoEm: new Date('2026-11-03T10:00:00Z'),
  total: 110,
  frete: 10,
  cliente: {
    nome: 'Ana de Souza',
    cnpj: '123.456.789-00',
    email: 'a@b.com',
    telefone: '(11) 90000-0000',
  },
  itens: [{ sku: 'BM-PT-M', nome: 'Bermuda', quantidade: 2, precoUnitario: 50 }],
  entrega: {
    cep: '03317-000',
    endereco: 'Rua A',
    numero: '10',
    bairro: 'Centro',
    cidade: 'São Paulo',
    uf: 'SP',
  },
};

describe('pedido da vitrine no Magis5 (03/11)', () => {
  it('leva canal, SKU, unidade e endereço sem máscara', () => {
    const r = montarPedidoMagis5(PEDIDO, 'api-1');
    expect(r.channel).toBe('api-1');
    expect(r.id).toBe('PED-1');
    expect(r.order_items[0]).toMatchObject({
      quantity: 2,
      unit_price: 50,
      unitMeasurement: 'UN',
      item: { id: 'BM-PT-M' },
    });
    expect(r.shipping.receiver_address.zip_code).toBe('03317000');
    expect(r.buyer.billing_info.doc_number).toBe('12345678900');
    expect(r.buyer.last_name).toBe('de Souza');
  });

  it('o "-" do campo não liga o envio', () => {
    expect(canalValido('-')).toBe(false);
    expect(canalValido(undefined)).toBe(false);
    expect(canalValido('api-0c7b')).toBe(true);
  });
});
