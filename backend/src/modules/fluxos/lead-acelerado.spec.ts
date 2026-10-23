import { describe, expect, it, vi } from 'vitest';
import { leadAcelerado, prazoAcelerado, prazoDoLead } from './lead-acelerado';

describe('lead de teste acelerado (Léo, 23/10)', () => {
  it('1 dia vira 1 minuto; nunca menos de 5 s', () => {
    expect(prazoAcelerado(24 * 3_600_000)).toBe(60_000);
    expect(prazoAcelerado(30 * 24 * 3_600_000)).toBe(30 * 60_000);
    expect(prazoAcelerado(60_000)).toBe(5_000);
  });

  it('só o lead com a etiqueta é acelerado; sem lead ou erro = prazo normal', async () => {
    const com = { lead: { count: vi.fn().mockResolvedValue(1) } };
    const sem = { lead: { count: vi.fn().mockResolvedValue(0) } };
    const quebra = { lead: { count: vi.fn().mockRejectedValue(new Error('db')) } };
    const dia = 24 * 3_600_000;
    expect(await prazoDoLead(com as never, 'e1', 'l1', dia)).toBe(60_000);
    expect(await prazoDoLead(sem as never, 'e1', 'l1', dia)).toBe(dia);
    expect(await prazoDoLead(quebra as never, 'e1', 'l1', dia)).toBe(dia);
    expect(await leadAcelerado(com as never, 'e1', undefined)).toBe(false);
    expect(com.lead.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'l1',
        empresaId: 'e1',
        tags: { some: { tag: { nome: { equals: 'teste-acelerado', mode: 'insensitive' } } } },
      }),
    });
  });
});
