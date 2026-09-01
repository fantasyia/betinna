import { describe, expect, it } from 'vitest';
import { ehRotaInterna } from './rota-interna';

describe('ehRotaInterna', () => {
  it.each(['/leads/abc123', '/pedidos?highlight=1', '/'])('aceita %s', (v) => {
    expect(ehRotaInterna(v)).toBe(true);
  });

  // Os dois primeiros sao o ponto: comecam com barra e AINDA ASSIM saem da origem.
  it.each([
    '//evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    'leads/abc',
  ])('recusa %s', (v) => {
    expect(ehRotaInterna(v)).toBe(false);
  });

  it.each([null, undefined, ''])('sem link nao navega (%s)', (v) => {
    expect(ehRotaInterna(v)).toBe(false);
  });
});
