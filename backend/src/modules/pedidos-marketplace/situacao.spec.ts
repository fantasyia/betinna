import { describe, expect, it } from 'vitest';
import { situacaoMl, situacaoShopee } from './situacao';

describe('situação do pedido (24/10)', () => {
  it('Shopee', () => {
    expect(situacaoShopee('READY_TO_SHIP')).toBe('A_ENVIAR');
    expect(situacaoShopee('SHIPPED')).toBe('ENVIADO');
    expect(situacaoShopee('TO_CONFIRM_RECEIVE')).toBe('ENVIADO');
    expect(situacaoShopee('COMPLETED')).toBe('ENTREGUE');
    expect(situacaoShopee('IN_CANCEL')).toBe('CANCELADO');
    expect(situacaoShopee('TO_RETURN')).toBe('EM_DEVOLUCAO');
    expect(situacaoShopee('UNPAID')).toBe('AGUARDANDO_PAGAMENTO');
  });

  it('Mercado Livre: pedido + envio', () => {
    expect(situacaoMl('paid', 'ready_to_ship')).toBe('A_ENVIAR');
    expect(situacaoMl('paid', null)).toBe('A_ENVIAR');
    expect(situacaoMl('paid', 'shipped')).toBe('ENVIADO');
    expect(situacaoMl('paid', 'delivered')).toBe('ENTREGUE');
    expect(situacaoMl('paid', 'not_delivered')).toBe('EM_DEVOLUCAO');
    expect(situacaoMl('cancelled', 'shipped')).toBe('CANCELADO');
    expect(situacaoMl('payment_required', null)).toBe('AGUARDANDO_PAGAMENTO');
  });
});
