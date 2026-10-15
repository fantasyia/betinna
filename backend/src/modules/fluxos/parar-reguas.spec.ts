import { describe, expect, it } from 'vitest';
import { motivoDoEvento } from './parar-reguas';

/** Parar a régua (Léo + #01, 14/10): qual evento é qual motivo. */
describe('motivoDoEvento', () => {
  it('respondeu e comprou', () => {
    expect(motivoDoEvento('LEAD_RESPONDEU', { leadId: 'l' })).toBe('RESPONDEU');
    expect(motivoDoEvento('PEDIDO_PAGO', { leadId: 'l' })).toBe('COMPROU');
  });

  it('mudou de FUNIL só quando o funil é outro (mudar de etapa no mesmo funil não para)', () => {
    expect(motivoDoEvento('LEAD_ETAPA_MUDOU', { funilId: 'recompra' }, 'vendas')).toBe(
      'MUDOU_FUNIL',
    );
    expect(motivoDoEvento('LEAD_ETAPA_MUDOU', { funilId: 'vendas' }, 'vendas')).toBeNull();
    expect(motivoDoEvento('LEAD_ETAPA_MUDOU', { funilId: 'vendas' }, null)).toBeNull();
  });

  it('os outros gatilhos não param nada', () => {
    expect(motivoDoEvento('PEDIDO_CRIADO', {})).toBeNull();
    expect(motivoDoEvento('LEAD_CRIADO', {})).toBeNull();
  });
});
