import { describe, expect, it } from 'vitest';
import { formularioRecente } from './lead-capture.service';

describe('trava do formulário do Meta (03/11)', () => {
  const agora = new Date('2026-11-03T12:00:00Z');

  it('mesmo formulário em menos de 24 h trava', () => {
    expect(formularioRecente({ f1: '2026-11-03T00:00:00Z' }, 'f1', agora)).toBe(true);
  });

  it('depois de 24 h, ou outro formulário, passa', () => {
    expect(formularioRecente({ f1: '2026-11-02T11:00:00Z' }, 'f1', agora)).toBe(false);
    expect(formularioRecente({ f1: '2026-11-03T00:00:00Z' }, 'f2', agora)).toBe(false);
    expect(formularioRecente(undefined, 'f1', agora)).toBe(false);
  });
});
