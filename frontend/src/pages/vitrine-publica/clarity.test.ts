import { afterEach, describe, expect, it } from 'vitest';
import { _resetClarity, iniciarClarity } from './clarity';

afterEach(() => {
  _resetClarity();
  document.head.innerHTML = '';
  delete window.clarity;
});

describe('iniciarClarity', () => {
  it('carrega a tag do projeto uma vez só', () => {
    expect(iniciarClarity('z1z4fnaulg')).toBe(true);
    expect(iniciarClarity('z1z4fnaulg')).toBe(false);
    const s = document.head.querySelectorAll('script');
    expect(s).toHaveLength(1);
    expect(s[0]!.src).toBe('https://www.clarity.ms/tag/z1z4fnaulg');
    expect(typeof window.clarity).toBe('function');
  });

  it('visita da equipe (modo interno) NÃO carrega', () => {
    expect(iniciarClarity('z1z4fnaulg', { interno: true })).toBe(false);
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('ID estranho não vira URL de script', () => {
    expect(iniciarClarity('x"><script>')).toBe(false);
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });
});
