import { describe, it, expect } from 'vitest';
import { canalSemTextoLivre } from './canais';

describe('canalSemTextoLivre', () => {
  it('Amazon: sempre bloqueado', () => {
    const r = canalSemTextoLivre('MARKETPLACE_AMAZON');
    expect(r.bloqueado).toBe(true);
    expect(r.motivo).toMatch(/Seller Central/);
  });

  it('TikTok: sempre bloqueado', () => {
    expect(canalSemTextoLivre('MARKETPLACE_TIKTOK').bloqueado).toBe(true);
  });

  it('Shopee: bloqueado só em devolução/disputa', () => {
    expect(canalSemTextoLivre('MARKETPLACE_SHOPEE', 'DEVOLUCAO').bloqueado).toBe(true);
    expect(canalSemTextoLivre('MARKETPLACE_SHOPEE', 'DISPUTA').bloqueado).toBe(true);
    expect(canalSemTextoLivre('MARKETPLACE_SHOPEE', 'GERAL').bloqueado).toBe(false);
    expect(canalSemTextoLivre('MARKETPLACE_SHOPEE').bloqueado).toBe(false);
  });

  it('WhatsApp e redes: nunca bloqueado', () => {
    expect(canalSemTextoLivre('WHATSAPP').bloqueado).toBe(false);
    expect(canalSemTextoLivre('INSTAGRAM').bloqueado).toBe(false);
    expect(canalSemTextoLivre('MARKETPLACE_ML', 'DISPUTA').bloqueado).toBe(false);
  });
});
