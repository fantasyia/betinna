import { describe, it, expect } from 'vitest';
import { descontoAVistaPct, type EmpresaConfig } from './useEmpresaConfig';

/**
 * Testes da ÚNICA função pura de DINHEIRO exportada no frontend nessas telas:
 * `descontoAVistaPct`. Ela decide o % de desconto à vista que o preview de
 * pedido/proposta aplica sobre o subtotal (NovoPedidoDialog / PropostasPage),
 * então se ela errar o cliente vê um total estimado errado → custo de confiança.
 *
 * IMPORTANTE (ver `notas` no relatório): o cálculo de subtotal/total em si NÃO
 * é uma função pura exportável — está inline (reduce + cap 90%) dentro dos
 * componentes NovoPedidoDialog.tsx e PropostasPage.tsx, e a fonte da verdade é o
 * backend (recalcula no save). ComissoesPage só EXIBE com fmtBRL, sem calcular.
 * Por isso aqui testamos a função pura que dá pra importar sem mexer em produção.
 *
 * Regra implementada (espelha PedidoPricingService.descontoAVistaPct no backend):
 *  - PIX (qualquer condição) → descontoPixPct, clampado em [0, 50]
 *  - BOLETO + condição 'avista' → descontoBoletoAvistaPct, clampado em [0, 50]
 *  - resto → 0
 */

const cfg = (over: Partial<EmpresaConfig> = {}): EmpresaConfig => ({
  id: 'emp-1',
  nome: 'Acme',
  descontoPixPct: null,
  descontoBoletoAvistaPct: null,
  ...over,
});

describe('descontoAVistaPct — guarda de dinheiro (preview de pedido/proposta)', () => {
  it('sem config (null/undefined) → 0 (não inventa desconto)', () => {
    expect(descontoAVistaPct(null, 'PIX', 'avista')).toBe(0);
    expect(descontoAVistaPct(undefined, 'PIX', 'avista')).toBe(0);
  });

  describe('PIX', () => {
    it('aplica descontoPixPct em qualquer condição de pagamento', () => {
      const c = cfg({ descontoPixPct: 7 });
      expect(descontoAVistaPct(c, 'PIX', 'avista')).toBe(7);
      expect(descontoAVistaPct(c, 'PIX', '30dias')).toBe(7);
      expect(descontoAVistaPct(c, 'PIX', null)).toBe(7);
      expect(descontoAVistaPct(c, 'PIX', undefined)).toBe(7);
    });

    it('é case-insensitive na forma de pagamento (pix/Pix/PIX)', () => {
      const c = cfg({ descontoPixPct: 5 });
      expect(descontoAVistaPct(c, 'pix', 'avista')).toBe(5);
      expect(descontoAVistaPct(c, 'Pix', 'avista')).toBe(5);
    });

    it('descontoPixPct ausente/null → 0', () => {
      expect(descontoAVistaPct(cfg({ descontoPixPct: null }), 'PIX', 'avista')).toBe(0);
      expect(descontoAVistaPct(cfg({ descontoPixPct: undefined }), 'PIX', 'avista')).toBe(0);
    });

    it('clampa o teto em 50% (não deixa desconto absurdo passar pro total)', () => {
      expect(descontoAVistaPct(cfg({ descontoPixPct: 80 }), 'PIX', 'avista')).toBe(50);
      expect(descontoAVistaPct(cfg({ descontoPixPct: 50 }), 'PIX', 'avista')).toBe(50);
    });

    it('clampa o piso em 0% (não vira acréscimo de preço)', () => {
      expect(descontoAVistaPct(cfg({ descontoPixPct: -10 }), 'PIX', 'avista')).toBe(0);
    });
  });

  describe('BOLETO', () => {
    it('aplica descontoBoletoAvistaPct SÓ quando condição é avista', () => {
      const c = cfg({ descontoBoletoAvistaPct: 4 });
      expect(descontoAVistaPct(c, 'BOLETO', 'avista')).toBe(4);
    });

    it('boleto a prazo (não-avista) → 0 (sem desconto à vista)', () => {
      const c = cfg({ descontoBoletoAvistaPct: 4 });
      expect(descontoAVistaPct(c, 'BOLETO', '30dias')).toBe(0);
      expect(descontoAVistaPct(c, 'BOLETO', null)).toBe(0);
      expect(descontoAVistaPct(c, 'BOLETO', undefined)).toBe(0);
    });

    it('é case-insensitive na forma e na condição (boleto/AVISTA)', () => {
      const c = cfg({ descontoBoletoAvistaPct: 6 });
      expect(descontoAVistaPct(c, 'boleto', 'AVISTA')).toBe(6);
      expect(descontoAVistaPct(c, 'Boleto', 'Avista')).toBe(6);
    });

    it('descontoBoletoAvistaPct ausente/null → 0', () => {
      expect(descontoAVistaPct(cfg({ descontoBoletoAvistaPct: null }), 'BOLETO', 'avista')).toBe(0);
    });

    it('clampa em [0, 50]', () => {
      expect(descontoAVistaPct(cfg({ descontoBoletoAvistaPct: 90 }), 'BOLETO', 'avista')).toBe(50);
      expect(descontoAVistaPct(cfg({ descontoBoletoAvistaPct: -5 }), 'BOLETO', 'avista')).toBe(0);
    });
  });

  describe('outras formas de pagamento → 0', () => {
    it('forma desconhecida não ganha desconto à vista', () => {
      const c = cfg({ descontoPixPct: 10, descontoBoletoAvistaPct: 10 });
      expect(descontoAVistaPct(c, 'CARTAO', 'avista')).toBe(0);
      expect(descontoAVistaPct(c, '', 'avista')).toBe(0);
      expect(descontoAVistaPct(c, null, 'avista')).toBe(0);
      expect(descontoAVistaPct(c, undefined, 'avista')).toBe(0);
    });
  });

  it('PIX e BOLETO não se misturam (PIX usa pixPct, não boletoPct)', () => {
    const c = cfg({ descontoPixPct: 3, descontoBoletoAvistaPct: 9 });
    expect(descontoAVistaPct(c, 'PIX', 'avista')).toBe(3);
    expect(descontoAVistaPct(c, 'BOLETO', 'avista')).toBe(9);
  });
});
