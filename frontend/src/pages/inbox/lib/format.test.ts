import { describe, it, expect } from 'vitest';
import { fmtPeer, formatTempoResposta, slaBadge, fmtRelative } from './format';

describe('fmtPeer (peer → telefone exibível)', () => {
  it('WhatsApp BR 13 dígitos (com 9) → +55 (DD) 9XXXX-XXXX', () => {
    expect(fmtPeer('WHATSAPP', '5511988887777@s.whatsapp.net')).toBe('+55 (11) 98888-7777');
  });

  it('WhatsApp BR 12 dígitos (sem 9) → +55 (DD) XXXX-XXXX', () => {
    expect(fmtPeer('WHATSAPP', '551133224455@s.whatsapp.net')).toBe('+55 (11) 3322-4455');
  });

  it('@lid (número oculto) → vazio (não mostra ID interno)', () => {
    expect(fmtPeer('WHATSAPP', '199999999999999@lid')).toBe('');
  });

  it('@g.us (grupo) → vazio (grupo não tem telefone)', () => {
    expect(fmtPeer('WHATSAPP', '120363000000000000@g.us')).toBe('');
  });

  it('telefone internacional plausível (8–15 díg) → +<dígitos>', () => {
    expect(fmtPeer('WHATSAPP', '14155552671@s.whatsapp.net')).toBe('+14155552671');
  });

  it('ID implausivelmente longo (>15 díg) → vazio', () => {
    expect(fmtPeer('WHATSAPP', '1234567890123456789@s.whatsapp.net')).toBe('');
  });

  it('canal não-WhatsApp → retorna o peer como está', () => {
    expect(fmtPeer('MARKETPLACE_ML', 'pack:123456')).toBe('pack:123456');
  });

  it('vazio/null → vazio', () => {
    expect(fmtPeer('WHATSAPP', '')).toBe('');
    expect(fmtPeer('WHATSAPP', null)).toBe('');
  });
});

describe('formatTempoResposta', () => {
  it('null → travessão', () => {
    expect(formatTempoResposta(null)).toBe('—');
  });
  it('< 1min → segundos', () => {
    expect(formatTempoResposta(45)).toBe('45s');
  });
  it('< 1h → minutos arredondados', () => {
    expect(formatTempoResposta(150)).toBe('3min'); // 2.5min → 3
  });
  it('>= 1h → "Xh Ymin"', () => {
    expect(formatTempoResposta(3900)).toBe('1h 5min');
  });
});

describe('slaBadge (cor por tempo de espera)', () => {
  const minAtras = (m: number) => new Date(Date.now() - m * 60000).toISOString();

  it('sem aguardandoDesde → null', () => {
    expect(slaBadge(null)).toBeNull();
    expect(slaBadge(undefined)).toBeNull();
  });
  it('até 30min → verde', () => {
    expect(slaBadge(minAtras(10))?.cor).toBe('var(--success)');
  });
  it('31–120min → amarelo', () => {
    expect(slaBadge(minAtras(90))?.cor).toBe('var(--warning)');
  });
  it('> 2h → vermelho', () => {
    expect(slaBadge(minAtras(200))?.cor).toBe('var(--danger)');
  });
});

describe('fmtRelative', () => {
  it('< 1min → "agora"', () => {
    expect(fmtRelative(new Date(Date.now() - 10_000).toISOString())).toBe('agora');
  });
  it('minutos', () => {
    expect(fmtRelative(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5min');
  });
  it('vazio → vazio', () => {
    expect(fmtRelative(null)).toBe('');
  });
});
