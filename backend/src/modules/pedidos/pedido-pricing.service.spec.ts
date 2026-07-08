import { describe, expect, it } from 'vitest';
import { PedidoPricingService } from './pedido-pricing.service';

describe('PedidoPricingService', () => {
  const svc = new PedidoPricingService();

  describe('itemTotal', () => {
    it('calcula total simples sem desconto', () => {
      const r = svc.itemTotal({ quantidade: 3, precoUnitario: 10, desconto: 0 });
      expect(r).toEqual({ subtotal: 30, desconto: 0, total: 30 });
    });

    it('aplica desconto % no item', () => {
      // 10un × R$5 = R$50, com 10% off = R$45
      const r = svc.itemTotal({ quantidade: 10, precoUnitario: 5, desconto: 10 });
      expect(r.subtotal).toBe(50);
      expect(r.desconto).toBe(5);
      expect(r.total).toBe(45);
    });

    it('limita desconto a 80% e arredonda a 2 casas', () => {
      const r = svc.itemTotal({ quantidade: 1, precoUnitario: 100, desconto: 150 });
      expect(r.desconto).toBe(80); // capa em 80%
      expect(r.total).toBe(20);
    });

    it('quantidade negativa ou zero não gera total negativo', () => {
      expect(svc.itemTotal({ quantidade: -5, precoUnitario: 10, desconto: 0 }).total).toBe(0);
    });
  });

  describe('pedidoTotals', () => {
    it('soma itens + aplica desconto geral + calcula comissão', () => {
      // 2 itens: 10x R$50 (sem desc) = 500 + 5x R$20 com 10% off = 90 → total 590
      // desconto geral 5% → 590 * 0.95 = 560.50
      // comissão 5% → 560.50 * 0.05 = 28.025 → 28.03
      const t = svc.pedidoTotals(
        [
          { quantidade: 10, precoUnitario: 50, desconto: 0 },
          { quantidade: 5, precoUnitario: 20, desconto: 10 },
        ],
        5,
      );
      expect(t.subtotal).toBe(600);
      expect(t.totalItens).toBe(590);
      expect(t.descontoGeral).toBe(29.5);
      expect(t.total).toBe(560.5);
      expect(t.comissao).toBe(28.03);
      // #21: desconto EFETIVO composto do pior item (10%) com o geral (5%): 1−(0.9)(0.95) = 14,5%.
      expect(t.maxDescontoPercentual).toBe(14.5);
    });

    it('CAÇADA-BUG #21: maxDescontoPercentual COMPÕE item + geral (não é o maior dos dois)', () => {
      const t = svc.pedidoTotals(
        [{ quantidade: 1, precoUnitario: 10, desconto: 3 }],
        25, // geral
      );
      // 1 − (1−0.03)(1−0.25) = 1 − 0.7275 = 27,25% (antes retornava 25 = só o maior).
      expect(t.maxDescontoPercentual).toBe(27.25);
    });

    it('#21: item 10% + geral 10% = 19% efetivo (rep de teto 10% agora precisa de aprovação)', () => {
      const t = svc.pedidoTotals([{ quantidade: 1, precoUnitario: 100, desconto: 10 }], 10);
      expect(t.maxDescontoPercentual).toBe(19); // 1−(0.9)(0.9)
      expect(svc.excedeTetoDesconto(t, 10)).toBe(true); // 19 > 10 → aprovação
    });

    it('capa desconto geral em 50%', () => {
      const t = svc.pedidoTotals([{ quantidade: 1, precoUnitario: 100, desconto: 0 }], 99);
      expect(t.maxDescontoPercentual).toBe(50);
      expect(t.total).toBe(50);
    });

    it('não retorna NaN ou Infinity em casos extremos', () => {
      const t = svc.pedidoTotals([], 0);
      expect(t.subtotal).toBe(0);
      expect(t.total).toBe(0);
      expect(t.comissao).toBe(0);
      expect(Number.isFinite(t.total)).toBe(true);
    });
  });

  describe('excedeTetoDesconto', () => {
    it('retorna true se max desconto > teto', () => {
      const totals = svc.pedidoTotals([{ quantidade: 1, precoUnitario: 100, desconto: 15 }], 0);
      expect(svc.excedeTetoDesconto(totals, 10)).toBe(true);
    });
    it('retorna false se max desconto <= teto', () => {
      const totals = svc.pedidoTotals([{ quantidade: 1, precoUnitario: 100, desconto: 5 }], 0);
      expect(svc.excedeTetoDesconto(totals, 10)).toBe(false);
      expect(svc.excedeTetoDesconto(totals, 5)).toBe(false);
    });
  });

  describe('resolverItemComOverride (CAÇADA-BUG #2)', () => {
    it('override ABAIXO do preço base vira desconto EFETIVO (teto enxerga)', () => {
      // base 100, override 10 → 90% de desconto disfarçado. precoUnitario volta pra base.
      const r = svc.resolverItemComOverride({ quantidade: 1, precoBase: 100, override: 10 });
      expect(r.precoUnitario).toBe(100);
      expect(r.desconto).toBeCloseTo(80, 4); // clamp em 80% (teto de item)
      // sem clamp: 100→25 seria 75%
      const r2 = svc.resolverItemComOverride({ quantidade: 1, precoBase: 100, override: 25 });
      expect(r2.desconto).toBeCloseTo(75, 4);
    });

    it('compõe override implícito + desconto explícito', () => {
      // base 100, override 80 (20% implícito) + 10% explícito → efetivo 28%.
      const r = svc.resolverItemComOverride({
        quantidade: 1,
        precoBase: 100,
        override: 80,
        descontoExplicito: 10,
      });
      expect(r.precoUnitario).toBe(100);
      expect(r.desconto).toBeCloseTo(28, 4);
    });

    it('override AUSENTE ou >= base não vira desconto implícito', () => {
      expect(
        svc.resolverItemComOverride({ quantidade: 2, precoBase: 100, descontoExplicito: 5 }),
      ).toEqual({
        quantidade: 2,
        precoUnitario: 100,
        desconto: 5,
      });
      // override ACIMA da base (rep cobrando mais): mantém o override como preço, sem desconto.
      expect(svc.resolverItemComOverride({ quantidade: 1, precoBase: 100, override: 120 })).toEqual(
        {
          quantidade: 1,
          precoUnitario: 120,
          desconto: 0,
        },
      );
    });
  });
});
