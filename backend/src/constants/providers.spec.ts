import { describe, expect, it } from 'vitest';
import { ML_WEBHOOK_IPS_DEFAULT, ipNaWhitelist } from './providers';

describe('ipNaWhitelist', () => {
  it('IP exato continua valendo', () => {
    expect(ipNaWhitelist('54.88.218.97', ['54.88.218.97'])).toBe(true);
    expect(ipNaWhitelist('54.88.218.98', ['54.88.218.97'])).toBe(false);
  });

  it('faixa CIDR aceita o que está dentro e recusa o resto', () => {
    const w = ['152.233.30.0/24'];
    expect(ipNaWhitelist('152.233.30.101', w)).toBe(true);
    expect(ipNaWhitelist('152.233.30.255', w)).toBe(true);
    expect(ipNaWhitelist('152.233.31.1', w)).toBe(false);
    expect(ipNaWhitelist('10.0.0.1', w)).toBe(false);
  });

  it('entrada ou IP inválido nunca libera', () => {
    expect(ipNaWhitelist('', ['152.233.30.0/24'])).toBe(false);
    expect(ipNaWhitelist('::1', ['152.233.30.0/24'])).toBe(false);
    expect(ipNaWhitelist('152.233.30.1', ['152.233.30.0/40'])).toBe(false);
    expect(ipNaWhitelist('152.233.30.1', ['lixo/24'])).toBe(false);
  });

  it('o default cobre os IPs que o ML usou em 14/11 (antes recusados)', () => {
    for (const ip of ['152.233.30.101', '152.233.30.102', '152.233.30.104']) {
      expect(ipNaWhitelist(ip, ML_WEBHOOK_IPS_DEFAULT)).toBe(true);
    }
  });
});
