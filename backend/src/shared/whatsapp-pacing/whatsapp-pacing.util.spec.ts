import { describe, expect, it } from 'vitest';
import {
  ENVIO_WHATSAPP_DEFAULT,
  incrementoMs,
  intervaloBaseMs,
  jitterMs,
  resolveEnvioWhatsapp,
} from './whatsapp-pacing.util';

describe('resolveEnvioWhatsapp', () => {
  it('sem config → defaults', () => {
    expect(resolveEnvioWhatsapp(undefined)).toEqual(ENVIO_WHATSAPP_DEFAULT);
  });

  it('saneia maxPorMinuto inválido/zero', () => {
    expect(resolveEnvioWhatsapp({ maxPorMinuto: 0 }).maxPorMinuto).toBe(15);
    expect(resolveEnvioWhatsapp({ maxPorMinuto: -3 }).maxPorMinuto).toBe(15);
    expect(resolveEnvioWhatsapp({ maxPorMinuto: 9999 }).maxPorMinuto).toBe(600); // cap
  });

  it('garante jitterMax >= jitterMin', () => {
    const c = resolveEnvioWhatsapp({ jitterMinSeg: 6, jitterMaxSeg: 2 });
    expect(c.jitterMinSeg).toBe(6);
    expect(c.jitterMaxSeg).toBe(6);
  });
});

describe('intervaloBaseMs', () => {
  it('15/min → 4000ms', () => {
    expect(intervaloBaseMs({ maxPorMinuto: 15, jitterMinSeg: 0, jitterMaxSeg: 0 })).toBe(4000);
  });
  it('60/min → 1000ms', () => {
    expect(intervaloBaseMs({ maxPorMinuto: 60, jitterMinSeg: 0, jitterMaxSeg: 0 })).toBe(1000);
  });
});

describe('jitterMs', () => {
  const cfg = { maxPorMinuto: 15, jitterMinSeg: 1, jitterMaxSeg: 5 };
  it('rnd=0 → mínimo; rnd→1 → máximo', () => {
    expect(jitterMs(cfg, 0)).toBe(1000);
    expect(jitterMs(cfg, 0.9999)).toBeGreaterThan(4900);
    expect(jitterMs(cfg, 0.9999)).toBeLessThanOrEqual(5000);
  });
  it('sempre dentro de [min,max]', () => {
    for (const rnd of [0, 0.25, 0.5, 0.75, 0.99]) {
      const j = jitterMs(cfg, rnd);
      expect(j).toBeGreaterThanOrEqual(1000);
      expect(j).toBeLessThanOrEqual(5000);
    }
  });
});

describe('incrementoMs', () => {
  it('base + jitter', () => {
    const cfg = { maxPorMinuto: 15, jitterMinSeg: 1, jitterMaxSeg: 1 };
    expect(incrementoMs(cfg, 0.5)).toBe(4000 + 1000);
  });
});
