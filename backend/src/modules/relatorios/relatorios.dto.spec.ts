import { describe, expect, it } from 'vitest';
import { periodoSchema } from './relatorios.dto';

describe('periodoSchema — funilId/representanteId sem .cuid()', () => {
  it('ACEITA funilId NÃO-cuid (funil criado por migration: funil_<hash>)', () => {
    // Regressão: .cuid() dava 400 "Invalid cuid" e o dashboard mostrava "Sem
    // leads ainda" ao selecionar o funil "Clientes" (id funil_75a8...).
    const r = periodoSchema.safeParse({ funilId: 'funil_75a8fe21924b16b43e261362' });
    expect(r.success).toBe(true);
  });

  it('ACEITA funilId cuid normal também', () => {
    expect(periodoSchema.safeParse({ funilId: 'cmpwz71kw0001n26o14asg0ed' }).success).toBe(true);
  });

  it('REJEITA funilId vazio', () => {
    expect(periodoSchema.safeParse({ funilId: '' }).success).toBe(false);
  });
});
