import { describe, expect, it, vi } from 'vitest';
import {
  ehTelefoneDeTeste,
  etiquetarSeTelefoneDeTeste,
  leadAcelerado,
  prazoAcelerado,
  prazoDoLead,
  telefonesDeTeste,
} from './lead-acelerado';

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

describe('telefones de teste (Léo, 23/10)', () => {
  const montar = (telefone: string | null, lista: unknown = ['+55 (11) 99752-4483']) => ({
    empresa: {
      findUnique: vi.fn().mockResolvedValue({ config: { testeAcelerado: { telefones: lista } } }),
    },
    lead: { findFirst: vi.fn().mockResolvedValue({ contatoTelefone: telefone }) },
    tag: { upsert: vi.fn().mockResolvedValue({ id: 'tag-ta' }) },
    leadTag: { upsert: vi.fn().mockResolvedValue({}) },
  });

  it('lista limpa e comparação pelos 8 últimos dígitos', () => {
    expect(
      telefonesDeTeste({ testeAcelerado: { telefones: ['11 9752', 1, '(11) 99752-4483'] } }),
    ).toEqual(['11997524483']);
    expect(ehTelefoneDeTeste('5511997524483', ['11997524483'])).toBe(true);
    expect(ehTelefoneDeTeste('5511997520000', ['11997524483'])).toBe(false);
    expect(ehTelefoneDeTeste(null, ['11997524483'])).toBe(false);
  });

  it('lead novo com telefone da lista ganha teste-acelerado', async () => {
    const p = montar('5511997524483');
    await etiquetarSeTelefoneDeTeste(p as never, 'e1', 'l1');
    expect(p.tag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId_nome: { empresaId: 'e1', nome: 'teste-acelerado' } },
      }),
    );
    expect(p.leadTag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { leadId: 'l1', tagId: 'tag-ta', origem: 'ia' } }),
    );
  });

  it('cliente de verdade, empresa sem lista ou erro: nada muda', async () => {
    const real = montar('5547999990000');
    await etiquetarSeTelefoneDeTeste(real as never, 'e1', 'l1');
    expect(real.leadTag.upsert).not.toHaveBeenCalled();

    const semLista = montar('5511997524483', null);
    await etiquetarSeTelefoneDeTeste(semLista as never, 'e1', 'l1');
    expect(semLista.lead.findFirst).not.toHaveBeenCalled();

    const quebra = montar('5511997524483');
    quebra.tag.upsert.mockRejectedValue(new Error('db'));
    await expect(etiquetarSeTelefoneDeTeste(quebra as never, 'e1', 'l1')).resolves.toBeUndefined();
  });
});
