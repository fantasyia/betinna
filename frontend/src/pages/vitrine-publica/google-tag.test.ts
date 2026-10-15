import { beforeEach, describe, expect, it } from 'vitest';
import { _resetarGoogleTag, compraGoogle, espelharEvento, iniciarGoogleTag, telefoneE164 } from './google-tag';
import { lerSendTo } from '@/pages/vitrine/GoogleTagConfig';

/** Tag do Google na vitrine (#04/Léo, 15/10): GA4 + Ads, eventos do pixel e a compra. */

const TAG = { ga4Id: 'G-8XEB9JV0KH', adsId: 'AW-18514151629', compraSendTo: 'AW-18514151629/WNmUCLPdqp0dEM2RnvxE' };
const chamadas = () => (window.dataLayer ?? []).map((a) => [...(a as IArguments)]);

beforeEach(() => {
  _resetarGoogleTag();
  delete window.gtag;
  window.dataLayer = [];
  document.head.querySelectorAll('script[src*="googletagmanager"]').forEach((s) => s.remove());
});

describe('tag do Google', () => {
  it('carrega o gtag.js uma vez e configura GA4 e Ads (Ads com conversões otimizadas)', () => {
    iniciarGoogleTag(TAG);
    iniciarGoogleTag(TAG);
    expect(document.head.querySelectorAll('script[src*="gtag/js?id=G-8XEB9JV0KH"]')).toHaveLength(1);
    const c = chamadas();
    expect(c).toContainEqual(['config', 'G-8XEB9JV0KH']);
    expect(c).toContainEqual(['config', 'AW-18514151629', { allow_enhanced_conversions: true }]);
  });

  it('desligada: nenhum evento sai', () => {
    espelharEvento('AddToCart', { content_ids: ['m1'] });
    compraGoogle({ pedidoId: 'p1', total: 10, pecas: 1 });
    expect(chamadas()).toEqual([]);
  });

  it('eventos do pixel viram os do GA4', () => {
    iniciarGoogleTag(TAG);
    espelharEvento('ViewContent', { content_ids: ['m1'], content_name: 'Bermuda' });
    espelharEvento('AddToCart', { content_ids: ['m1'], content_name: 'Bermuda', num_items: 12 });
    espelharEvento('InitiateCheckout', { value: 480, num_items: 12 });
    espelharEvento('Purchase', { value: 480 }); // a compra NÃO vai por aqui
    const ev = chamadas().filter((x) => x[0] === 'event');
    expect(ev).toEqual([
      ['event', 'view_item', { currency: 'BRL', items: [{ item_id: 'm1', item_name: 'Bermuda' }] }],
      ['event', 'add_to_cart', { currency: 'BRL', items: [{ item_id: 'm1', item_name: 'Bermuda', quantity: 12 }] }],
      ['event', 'begin_checkout', { currency: 'BRL', value: 480 }],
    ]);
  });

  it('compra: user_data (e-mail + telefone E.164), purchase do GA4 e conversão do Ads com o mesmo transaction_id', () => {
    iniciarGoogleTag(TAG);
    compraGoogle({ pedidoId: 'ped-9', total: 1234.5, pecas: 30, email: ' Ana@X.com ', whatsapp: '(11) 99999-0000', clienteNovo: true });
    const c = chamadas();
    expect(c).toContainEqual(['set', 'user_data', { email: 'ana@x.com', phone_number: '+5511999990000' }]);
    const purchase = c.find((x) => x[1] === 'purchase')![2] as Record<string, unknown>;
    expect(purchase).toMatchObject({ transaction_id: 'ped-9', value: 1234.5, currency: 'BRL', new_customer: true });
    expect(c.find((x) => x[1] === 'conversion')![2]).toEqual({
      send_to: TAG.compraSendTo,
      transaction_id: 'ped-9',
      value: 1234.5,
      currency: 'BRL',
      new_customer: true,
    });
  });

  it('telefone e send_to colado', () => {
    expect(telefoneE164('5511999990000')).toBe('+5511999990000');
    expect(telefoneE164('123')).toBeUndefined();
    expect(lerSendTo('AW-18514151629/WNmUCLPdqp0dEM2RnvxE')).toEqual({ adsId: 'AW-18514151629', label: 'WNmUCLPdqp0dEM2RnvxE' });
    expect(lerSendTo('WNmUC')).toEqual({ adsId: null, label: 'WNmUC' });
  });
});
