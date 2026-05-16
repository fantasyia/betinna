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
      expect(t.maxDescontoPercentual).toBe(10);
    });

    it('maxDescontoPercentual considera o maior entre desconto geral e item', () => {
      const t = svc.pedidoTotals(
        [{ quantidade: 1, precoUnitario: 10, desconto: 3 }],
        25, // geral maior
      );
      expect(t.maxDescontoPercentual).toBe(25);
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
});
