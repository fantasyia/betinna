import { describe, expect, it } from 'vitest';
import {
  ENVIO_WHATSAPP_DEFAULT,
  type EnvioWhatsappConfig,
  incrementoMs,
  intervaloBaseMs,
  jitterMs,
  resolveEnvioWhatsapp,
} from './whatsapp-pacing.util';

const cfg = (over: Partial<EnvioWhatsappConfig> = {}): EnvioWhatsappConfig => ({
  maxPorMinuto: 12,
  maxPorMinutoReativo: 30,
  jitterMinSeg: 1,
  jitterMaxSeg: 4,
  ...over,
});

describe('resolveEnvioWhatsapp', () => {
  it('sem config → defaults', () => {
    expect(resolveEnvioWhatsapp(undefined)).toEqual(ENVIO_WHATSAPP_DEFAULT);
  });

  it('saneia maxPorMinuto/reativo inválido ou fora do range', () => {
    expect(resolveEnvioWhatsapp({ maxPorMinuto: 0 }).maxPorMinuto).toBe(12);
    expect(resolveEnvioWhatsapp({ maxPorMinuto: -3 }).maxPorMinuto).toBe(12);
    expect(resolveEnvioWhatsapp({ maxPorMinuto: 9999 }).maxPorMinuto).toBe(600); // cap
    expect(resolveEnvioWhatsapp({ maxPorMinutoReativo: 0 }).maxPorMinutoReativo).toBe(30);
    expect(resolveEnvioWhatsapp({ maxPorMinutoReativo: 50 }).maxPorMinutoReativo).toBe(50);
  });

  it('garante jitterMax >= jitterMin', () => {
    const c = resolveEnvioWhatsapp({ jitterMinSeg: 6, jitterMaxSeg: 2 });
    expect(c.jitterMinSeg).toBe(6);
    expect(c.jitterMaxSeg).toBe(6);
  });
});

describe('intervaloBaseMs', () => {
  it('12/min → 5000ms; 30/min → 2000ms; 60/min → 1000ms', () => {
    expect(intervaloBaseMs(12)).toBe(5000);
    expect(intervaloBaseMs(30)).toBe(2000);
    expect(intervaloBaseMs(60)).toBe(1000);
  });
});

describe('jitterMs', () => {
  it('rnd=0 → mínimo; rnd→1 → máximo; sempre dentro de [min,max]', () => {
    const c = cfg({ jitterMinSeg: 1, jitterMaxSeg: 5 });
    expect(jitterMs(c, 0)).toBe(1000);
    expect(jitterMs(c, 0.9999)).toBeLessThanOrEqual(5000);
    for (const rnd of [0, 0.25, 0.5, 0.75, 0.99]) {
      const j = jitterMs(c, rnd);
      expect(j).toBeGreaterThanOrEqual(1000);
      expect(j).toBeLessThanOrEqual(5000);
    }
  });
});

describe('incrementoMs', () => {
  it('proativo usa maxPorMinuto; reativo usa maxPorMinutoReativo', () => {
    const c = cfg({ maxPorMinuto: 12, maxPorMinutoReativo: 30, jitterMinSeg: 1, jitterMaxSeg: 1 });
    expect(incrementoMs(c, 0.5, false)).toBe(5000 + 1000); // proativo: base 5s
    expect(incrementoMs(c, 0.5, true)).toBe(2000 + 1000); // reativo: base 2s
  });
});
